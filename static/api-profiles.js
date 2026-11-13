// Device storage protects against plaintext-at-rest disclosure, not same-origin XSS.
// A script running in this origin/browser profile can use its non-extractable key.
// This is not an OS credential vault or a guarantee against a compromised browser.
(function () {
  const DB_NAME = 'vjbot_ai_profiles_v1', ACTIVE = 'vjbot_ai_active_v1:', VOICE = 'vjbot_voice_profile_v1:';
  const BASES = {openai: 'https://api.openai.com/v1', anthropic: 'https://api.anthropic.com', gemini: 'https://generativelanguage.googleapis.com'};
  const SUFFIX = {openai: /\/chat\/completions$/, anthropic: /\/v1\/messages$/, gemini: /\/v1(beta)?$/};
  const BLOCKED = /(^|\.)(localhost|local|internal|localdomain|home|lan|workers\.dev|dangphuc\.me)$/i;
  const PATHS = ['/api/chat', '/api/kaiwa/evaluate', '/api/practice/coach', '/api/tts', '/api/stt', '/api/ai/test'];
  const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', {fatal: true});
  const unavailable = () => problem('Device API profile unavailable. Open API settings and re-save or select a profile.', 'unavailable');
  const storageError = () => problem('Browser storage unavailable. Allow site storage and use a supported browser with IndexedDB and Web Crypto; the profile was not saved.', 'storage');
  let opening = null, voiceVersion = 0;

  function problem(message, code = 'invalid') { return Object.assign(new Error(message), {code}); }
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const modelOk = value => typeof value === 'string' && value.length <= 100 && /^~?[\w.:/-]+$/.test(value);
  const keyOk = value => typeof value === 'string' && /^[\x21-\x7e]{8,512}$/.test(value);
  const idOk = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
  const identityOk = value => value === null || (typeof value === 'string' && /^[A-Za-z0-9_+/=-]{1,256}$/.test(value));
  function account(owner) {
    if (typeof owner !== 'string' || !owner.trim() || owner.length > 256 || /[\x00-\x1f\x7f]/.test(owner)) throw problem('Invalid account. Sign in before using device profiles.');
    return owner;
  }
  function identifier(id) { if (!idOk(id)) throw problem('Invalid profile id.'); return id; }
  function baseUrl(protocol, raw) {
    if (!Object.hasOwn(BASES, protocol)) throw problem('Invalid API protocol.');
    if (raw !== undefined && typeof raw !== 'string') throw problem('Invalid API URL.');
    const text = raw?.trim() || '';
    if (!text) return BASES[protocol];
    let url;
    try { url = new URL(text); } catch { throw problem('Invalid API URL.'); }
    const host = url.hostname;
    if (text.length > 200 || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
      || !host.includes('.') || host.includes(':') || /^[\d.]+$/.test(host) || BLOCKED.test(host)) {
      throw problem('API URL must be public HTTPS without credentials, query, fragment or IP address.');
    }
    return url.origin + url.pathname.replace(/\/+$/, '').replace(SUFFIX[protocol], '');
  }
  function fields(profile) {
    if (!object(profile)) throw problem('Invalid profile.');
    if (typeof profile.name !== 'string' || !profile.name.trim() || profile.name.trim().length > 80 || /[\x00-\x1f\x7f]/.test(profile.name)) throw problem('Invalid profile name (1–80 characters).');
    if (profile.model !== '' && !modelOk(profile.model)) throw problem('Invalid model ID.');
    return {name: profile.name.trim(), protocol: profile.protocol, base_url: baseUrl(profile.protocol, profile.base_url), model: profile.model};
  }
  function historyInput(profile) {
    const identity = profile.connection_id ?? null, models = profile.models === undefined ? [] : profile.models, checked = profile.checked_at ?? null;
    if (!identityOk(identity) || !Array.isArray(models) || models.length > 1000 || !models.every(modelOk)
      || (checked !== null && (!Number.isFinite(checked) || checked <= 0 || checked > Date.now() + 60000))) throw problem('Invalid model check history.');
    return {connection_id: identity, models: [...new Set(models)], checked_at: checked};
  }
  function publicProfile(row) {
    return {id: row.id, name: row.name, protocol: row.protocol, base_url: row.base_url, model: row.model,
      key_last4: row.key_last4, connection_id: row.connection_id, models: [...row.models], checked_at: row.checked_at};
  }
  function record(row, owner, id) {
    try {
      if (!object(row) || row.version !== 1 || row.owner !== owner || row.id !== id || !idOk(id) || !idOk(row.revision)
        || typeof row.key_last4 !== 'string' || !/^[\x21-\x7e]{4}$/.test(row.key_last4)
        || !(row.iv instanceof Uint8Array) || row.iv.length !== 12 || !(row.ciphertext instanceof ArrayBuffer)
        || row.ciphertext.byteLength < 24 || row.ciphertext.byteLength > 528) throw unavailable();
      const clean = fields(row), history = historyInput(row);
      if (clean.name !== row.name || clean.base_url !== row.base_url || !Object.hasOwn(row, 'connection_id')
        || !Object.hasOwn(row, 'checked_at') || !Array.isArray(row.models)
        || history.connection_id !== row.connection_id || history.checked_at !== row.checked_at
        || (row.models.length && (!history.connection_id || !history.checked_at))) throw unavailable();
      return row;
    } catch { throw unavailable(); }
  }
  function cryptoReady() {
    if (!globalThis.crypto?.subtle || !globalThis.crypto?.getRandomValues || !globalThis.crypto?.randomUUID) throw storageError();
  }
  function open() {
    cryptoReady();
    if (!globalThis.indexedDB) return Promise.reject(storageError());
    if (!opening) opening = new Promise((resolve, reject) => {
      let request, failed = false;
      const fail = () => {failed = true; reject(storageError());};
      try { request = indexedDB.open(DB_NAME, 1); } catch { fail(); return; }
      request.onupgradeneeded = () => {
        try {
          const db = request.result;
          if (!db.objectStoreNames.contains('keys')) db.createObjectStore('keys', {keyPath: 'owner'});
          if (!db.objectStoreNames.contains('profiles')) db.createObjectStore('profiles', {keyPath: ['owner', 'id']}).createIndex('owner', 'owner');
        } catch { fail(); request.transaction?.abort(); }
      };
      request.onerror = fail;
      request.onblocked = fail;
      request.onsuccess = () => {
        if (failed) {request.result.close(); return;}
        request.result.onversionchange = () => {request.result.close(); opening = null;};
        resolve(request.result);
      };
    }).catch(error => {opening = null; throw error;});
    return opening;
  }
  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(storageError());
    });
  }
  async function transaction(names, mode, action) {
    const db = await open();
    return new Promise((resolve, reject) => {
      let tx, result, failure;
      try { tx = db.transaction(names, mode); } catch { reject(storageError()); return; }
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(failure || storageError());
      tx.onabort = () => reject(failure || storageError());
      Promise.resolve().then(() => action(tx)).then(value => {result = value;}, error => {
        failure = error?.code ? error : storageError();
        try { tx.abort(); } catch { reject(failure); }
      });
    });
  }
  function usableKey(row, owner) {
    if (!row || row.owner !== owner || !row.key || row.key.type !== 'secret' || row.key.extractable !== false
      || row.key.algorithm?.name !== 'AES-GCM' || row.key.algorithm.length !== 256
      || !Array.isArray(row.key.usages) || !row.key.usages.includes('encrypt') || !row.key.usages.includes('decrypt')) throw unavailable();
    return row.key;
  }
  async function accountKey(owner, create) {
    const existing = await transaction(['keys'], 'readonly', tx => requestResult(tx.objectStore('keys').get(owner)));
    if (existing) return usableKey(existing, owner);
    if (!create) throw unavailable();
    let generated;
    try { generated = await crypto.subtle.generateKey({name: 'AES-GCM', length: 256}, false, ['encrypt', 'decrypt']); }
    catch { throw storageError(); }
    // Generate outside the transaction; its structured-cloned CryptoKey is committed atomically.
    return transaction(['keys'], 'readwrite', async tx => {
      const store = tx.objectStore('keys'), current = await requestResult(store.get(owner));
      if (current) return usableKey(current, owner);
      await requestResult(store.put({owner, key: generated}));
      return generated;
    });
  }
  const aad = row => encoder.encode(JSON.stringify(['vjbot-device-key-v1', row.owner, row.id, row.protocol, row.base_url, row.connection_id]));
  async function decrypt(row, key) {
    try {
      const bytes = await crypto.subtle.decrypt({name: 'AES-GCM', iv: row.iv, additionalData: aad(row)}, key, row.ciphertext);
      const apiKey = decoder.decode(bytes);
      if (!keyOk(apiKey) || apiKey.slice(-4) !== row.key_last4) throw unavailable();
      return apiKey;
    } catch { throw unavailable(); }
  }
  async function read(owner, id) {
    const row = await transaction(['profiles'], 'readonly', tx => requestResult(tx.objectStore('profiles').get([owner, id])));
    if (!row) throw unavailable();
    return record(row, owner, id);
  }
  async function list(owner) {
    account(owner);
    const rows = await transaction(['profiles'], 'readonly', tx => requestResult(tx.objectStore('profiles').index('owner').getAll(owner)));
    if (rows.length > 20) throw unavailable();
    return rows.map(row => publicProfile(record(row, owner, row.id)));
  }
  async function load(owner, id) {
    account(owner); identifier(id);
    const row = await read(owner, id), key = await accountKey(owner, false);
    return {...publicProfile(row), api_key: await decrypt(row, key)};
  }
  async function save(owner, profile) {
    account(owner);
    const clean = fields(profile), suppliedHistory = historyInput(profile);
    const suppliedKey = profile.api_key, hasKey = suppliedKey !== undefined && suppliedKey !== '';
    if (hasKey && !keyOk(suppliedKey)) throw problem('Invalid API key (8–512 printable non-space characters).');
    const updating = profile.id !== undefined;
    if (updating) identifier(profile.id);
    if (!updating && !hasKey) throw problem('Enter an API key to save a new profile.');
    const hasHistory = ['connection_id', 'models', 'checked_at'].some(field => Object.hasOwn(profile, field));
    cryptoReady();
    const id = updating ? profile.id : crypto.randomUUID();
    const previous = updating ? await read(owner, id) : null;
    const sameEndpoint = previous && previous.protocol === clean.protocol && previous.base_url === clean.base_url;
    if (previous && !hasKey && !sameEndpoint) throw problem('Enter an API key for the new endpoint and protocol.');
    const key = await accountKey(owner, !updating);
    const oldKey = previous ? await decrypt(previous, key) : null;
    const apiKey = hasKey ? suppliedKey : oldKey;
    const sameConnection = Boolean(previous && sameEndpoint && apiKey === oldKey);
    let history = {connection_id: null, models: [], checked_at: null};
    // Check history is descriptive browser-writable metadata, never authorization or quota.
    // A fresh scan can accompany changed credentials, but an old identity must not follow them.
    if (!previous || (sameConnection && (!previous.connection_id || suppliedHistory.connection_id === previous.connection_id))
      || (!sameConnection && suppliedHistory.connection_id && suppliedHistory.connection_id !== previous.connection_id)) {
      if (suppliedHistory.connection_id) history = {...suppliedHistory,
        models: suppliedHistory.checked_at ? suppliedHistory.models : [], checked_at: suppliedHistory.checked_at};
    }
    if (sameConnection && !hasHistory) history = {connection_id: previous.connection_id, models: [...previous.models], checked_at: previous.checked_at};
    const row = {version: 1, owner, id, ...clean, ...history, key_last4: apiKey.slice(-4), revision: crypto.randomUUID(),
      iv: crypto.getRandomValues(new Uint8Array(12))};
    try { row.ciphertext = await crypto.subtle.encrypt({name: 'AES-GCM', iv: row.iv, additionalData: aad(row)}, key, encoder.encode(apiKey)); }
    catch { throw storageError(); }
    await transaction(['profiles'], 'readwrite', async tx => {
      const store = tx.objectStore('profiles');
      const current = await requestResult(store.get([owner, id]));
      if ((previous && current?.revision !== previous.revision) || (!previous && current)) throw problem('Profile changed in another tab. Reload API settings and try again.', 'conflict');
      const rows = await requestResult(store.index('owner').getAll(owner));
      if (!previous && rows.length >= 20) throw problem('A maximum of 20 device profiles can be saved for this account.');
      await requestResult(store.put(row));
    });
    let selectedVoice;
    try { selectedVoice = voice(owner); } catch { /* Saving credentials does not repair a corrupt voice reference. */ }
    if (!sameConnection && selectedVoice?.scope === 'local' && selectedVoice.id === id) voiceChanged(owner);
    return publicProfile(row);
  }
  const validSelection = (choice, prefix) => object(choice) && (choice.scope === 'none' ? choice.id === ''
    : ['local', 'server'].includes(choice.scope) ? idOk(choice.id)
    : prefix === VOICE && choice.scope === 'platform' && choice.id === 'openai');
  function selection(owner, prefix) {
    account(owner);
    let raw;
    try { raw = localStorage.getItem(prefix + owner); } catch { throw storageError(); }
    if (raw === null) return null;
    try {
      const choice = JSON.parse(raw);
      if (!validSelection(choice, prefix)) throw unavailable();
      return {scope: choice.scope, id: choice.id};
    } catch { throw unavailable(); }
  }
  const active = owner => selection(owner, ACTIVE);
  const voice = owner => selection(owner, VOICE);
  function voiceChanged(owner) {
    if (typeof signedInUser !== 'undefined' && signedInUser?.user_id !== owner) return;
    voiceVersion++;
    globalThis.dispatchEvent?.(new Event('vjbot-voice-changed'));
  }
  function setSelection(owner, choice, prefix) {
    account(owner);
    if (choice !== null && !validSelection(choice, prefix)) throw problem('Invalid active profile choice.');
    try {
      if (choice === null) {
        localStorage.removeItem(prefix + owner);
        if (localStorage.getItem(prefix + owner) !== null) throw storageError();
      } else {
        const value = JSON.stringify({scope: choice.scope, id: choice.id});
        localStorage.setItem(prefix + owner, value);
        if (localStorage.getItem(prefix + owner) !== value) throw storageError();
      }
    } catch { throw storageError(); }
  }
  const setActive = (owner, choice) => setSelection(owner, choice, ACTIVE);
  function setVoice(owner, choice) {
    let previous;
    try { previous = voice(owner); } catch { previous = undefined; }
    setSelection(owner, choice, VOICE);
    if (JSON.stringify(previous) !== JSON.stringify(voice(owner))) voiceChanged(owner);
  }
  async function remove(owner, id) {
    account(owner); identifier(id);
    // Keep an explicit no-selection tombstone instead of falling back to a server key.
    // Clear selection before deleting: a storage error must not report a successful deletion.
    const selected = active(owner);
    if (selected?.scope === 'local' && selected.id === id) setActive(owner, {scope: 'none', id: ''});
    let selectedVoice;
    try { selectedVoice = voice(owner); } catch { /* A corrupt voice reference must not block deleting independent credentials. */ }
    if (selectedVoice?.scope === 'local' && selectedVoice.id === id) setVoice(owner, {scope: 'none', id: ''});
    await transaction(['profiles'], 'readwrite', tx => requestResult(tx.objectStore('profiles').delete([owner, id])));
  }
  async function clear(owner) {
    account(owner);
    let selectionError;
    try { setActive(owner, {scope: 'none', id: ''}); } catch (error) { selectionError = error; }
    try { setVoice(owner, {scope: 'none', id: ''}); } catch (error) { selectionError ||= error; }
    // Even when preference storage fails, attempt to erase this account's secrets.
    await transaction(['profiles', 'keys'], 'readwrite', async tx => {
      const store = tx.objectStore('profiles'), rows = await requestResult(store.index('owner').getAll(owner));
      if (rows.some(row => row.owner !== owner)) throw unavailable();
      await Promise.all(rows.map(row => requestResult(store.delete([owner, row.id]))));
      await requestResult(tx.objectStore('keys').delete(owner));
    });
    if (selectionError) throw selectionError;
  }
  async function prepareRequest(path, options = {}, owner) {
    const result = {...options};
    // Compare exact strings rather than normalized URLs: queries, aliases, dot segments,
    // encoded paths and external URLs must never acquire a device credential.
    const origin = globalThis.location?.origin;
    if (typeof path !== 'string' || !PATHS.some(allowed => path === allowed || (origin && path === origin + allowed))
      || typeof options.method !== 'string' || options.method.toUpperCase() !== 'POST') return result;
    const speech = path === '/api/tts' || path === origin + '/api/tts';
    const revision = voiceVersion;
    const selected = speech ? voice(owner) : active(owner);
    if (speech && (!selected || selected.scope === 'none')) throw problem('No voice profile selected. Choose a voice account in Settings.');
    if (selected?.scope === 'none') throw problem('No API profile selected. Choose a profile in API settings before continuing.');
    if (speech && selected?.scope === 'platform' && selected.id === 'openai') {
      const headers = new Headers(options.headers);
      headers.set('X-VJBot-Profile', 'platform_openai');
      result.headers = Object.fromEntries(headers);
      return result;
    }
    if (selected?.scope === 'server') {
      const headers = new Headers(options.headers);
      headers.set('X-VJBot-Profile', selected.id);
      result.headers = Object.fromEntries(headers);
      return result;
    }
    if (selected?.scope !== 'local') return result;
    let body;
    try {
      if (typeof options.body !== 'string') throw unavailable();
      body = JSON.parse(options.body);
      if (!object(body)) throw unavailable();
    } catch { throw problem('Invalid JSON request. Reopen this page before using the device profile.'); }
    let profile;
    try { profile = await load(owner, selected.id); } catch { throw unavailable(); }
    const current = speech ? voice(owner) : active(owner);
    if (speech && revision !== voiceVersion) throw unavailable();
    if (current?.scope !== 'local' || current.id !== selected.id) throw unavailable();
    if (speech && !((profile.protocol === 'gemini' && profile.base_url === BASES.gemini)
      || (profile.protocol === 'openai' && profile.base_url === BASES.openai))) throw problem('Voice requires native Gemini or official OpenAI.');
    if (!speech && !profile.model) throw problem('Choose and check a model in API settings before using this device profile.');
    const headers = new Headers(options.headers);
    headers.delete('X-VJBot-Profile');
    result.headers = Object.fromEntries(headers);
    result.body = JSON.stringify({...body, api_connection: {protocol: profile.protocol, base_url: profile.base_url, model: profile.model, api_key: profile.api_key}});
    return result;
  }
  globalThis.addEventListener?.('storage', event => {
    const owner = typeof signedInUser === 'undefined' ? null : signedInUser?.user_id;
    if (event.key === null || (owner && event.key === VOICE + owner)) voiceChanged(owner);
  });
  globalThis.VJProfiles = Object.freeze({list, load, save, remove, clear, active, setActive, voice, setVoice, prepareRequest});
})();
