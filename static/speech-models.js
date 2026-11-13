// Catalog entries are candidates, not successful synthesis or pricing guarantees.
(function () {
  const select = document.getElementById('speech-model');
  const status = document.getElementById('speech-model-status');
  const refresh = document.getElementById('speech-model-refresh');
  const fallback = 'gemini-3.8-flash-tts';
  let pending = null, version = 0;
  const pageChoices = new Map();
  function identity() {
    const owner = typeof signedInUser === 'undefined' ? null : signedInUser?.user_id;
    if (!owner) return '';
    const profile = window.VJProfiles?.active(owner);
    return JSON.stringify([owner, profile?.scope || 'server', profile?.id || 'default']);
  }
  function choice(key = identity()) {
    if (pageChoices.has(key)) return pageChoices.get(key);
    try {return localStorage.getItem('vjbot_speech_model:' + key) || fallback;}
    catch {status.textContent = 'Speech preference storage is unavailable. The current page selection is used.'; return select.value || fallback;}
  }
  function draw(models, selected) {
    select.replaceChildren();
    for (const model of [...new Set([selected, ...models])]) {
      const option = document.createElement('option');
      option.value = model;
      option.textContent = model + (models.includes(model) ? '' : ' · current, not in latest catalog');
      select.append(option);
    }
    select.value = selected;
  }
  async function update() {
    const key = identity();
    if (!key) return;
    pending?.abort();
    const controller = new AbortController(), request = ++version;
    pending = controller;
    draw([], choice(key));
    status.textContent = 'Refreshing compatible Gemini speech models. No audio tests are sent.';
    try {
      const response = await apiFetch('/api/tts', {method:'POST', signal:controller.signal,
        headers:{'Content-Type':'application/json'}, body:JSON.stringify({action:'models'})});
      const data = await response.json();
      if (controller.signal.aborted || request !== version || key !== identity()) return;
      if (!response.ok) throw new Error(data.detail || 'Unable to refresh speech models.');
      if (!Array.isArray(data.models) || !data.models.every(model => typeof model === 'string' && model.length <= 100)) throw new Error('Invalid speech model catalog.');
      if(data.voice === 'alloy'){
        const model=data.default_model || 'gpt-4o-mini-tts';pageChoices.set(key,model);draw(data.models,model);
        status.textContent='OpenAI speech · alloy · '+model;return;
      }
      draw(data.models, choice(key));
      status.textContent = `${data.models.length} compatible catalog candidates${data.truncated ? ' (partial list)' : ''}. Charon stays selected. New models are not voice-tested; quota and charges may differ. Choose explicitly to change model.`;
    } catch (error) {
      if (controller.signal.aborted || request !== version || key !== identity()) return;
      status.textContent = error.message || 'Unable to refresh speech models. Your choice has not changed.';
    } finally {
      if (request === version) pending = null;
    }
  }
  select.addEventListener('change', () => {
    stopSpeech();
    pageChoices.set(identity(), select.value);
    try {localStorage.setItem('vjbot_speech_model:' + identity(), select.value);}
    catch {status.textContent = 'Unable to save the speech choice. This page will use the selected model.';}
  });
  refresh.addEventListener('click', update);
  window.refreshSpeechModels = update;
  window.selectedSpeechModel = () => choice();
})();
