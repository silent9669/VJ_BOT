(function () {
  const el=id=>document.getElementById('voice-v2-'+id);
  const prefix='vjbot_voice_routing_v2:';
  const bases={elevenlabs:'https://api.elevenlabs.io',mistral:'https://api.mistral.ai/v1',openai:'https://api.openai.com/v1',gemini:'https://generativelanguage.googleapis.com',openai_compatible:''};
  const titles={primary:'Kết nối chính',ja:'Tiếng Nhật',vi:'Tiếng Việt'};
  const mistralPresets={ja:'Haruto · Tiếng Nhật (nam)',vi:'Huong · Tiếng Việt (nữ)'};
  const elevenModelHints={eleven_v3:'Ưu tiên độ rõ Nhật–Việt',eleven_turbo_v2_5:'Nhanh và rõ cho hội thoại',
    eleven_flash_v2_5:'Ưu tiên tốc độ · mặc định'};
  const mode=el('mode'), slots=el('slots'), status=el('status'), kind=el('kind'), url=el('url');
  const liveEngine=el('live-engine'), liveTurn=el('live-turn'), liveBarge=el('live-barge'),
    liveStt=el('live-stt'), liveSlot=el('live-stt-slot'), liveSlotField=el('live-stt-slot-field'), liveOptions=el('live-options');
  const liveLanguage=el('live-stt-language'), browserSttHint=el('live-browser-stt-hint');
  const controls=new Map(), catalogs=new Map(), selectedAccounts=new Map(), drafts=new Map();
  let rows=[], metadataRole, drawnIdentity, busy=false, pendingRemoval=null, routingRevision=0, restoredLive, accountOwner;
  const owner=()=>signedInUser?.user_id;
  const admin=()=>signedInUser?.is_admin===true;
  const ref=row=>`${row.scope}:${row.id}`;
  const provider=row=>row.protocol==='openai' && row.base_url===bases.mistral ? 'mistral' : row.protocol;
  const roleKey=()=>JSON.stringify([owner(),admin()]);
  const modes=['single','dual_same_api','dual_split_api'];
  const names=Object.keys(titles);
  const sttProviders=['openai','mistral','elevenlabs'];
  const voiceChanged=config=>window.dispatchEvent(new CustomEvent('vjbot-voice-changed',{detail:{source:'routing-v2',live:liveConfig(config)}}));
  const fingerprint=row=>[row.base_url,row.connection_id,row.revision];
  const reloadProfiles=()=>window.loadVoiceProfiles?.({personalVoice:true});
  function tabs(entries,onSelect) {
    const select=(index,focus=false)=>{
      entries.forEach(([tab,panel],i)=>{
        tab.setAttribute('aria-selected',String(i===index));
        tab.tabIndex=i===index?0:-1;
        panel.hidden=i!==index;
      });
      if (focus) entries[index][0].focus();
      onSelect?.(index);
    };
    entries.forEach(([tab],index)=>{
      tab.addEventListener('click',()=>select(index));
      tab.addEventListener('keydown',event=>{
        const next={ArrowLeft:index-1,ArrowRight:index+1,Home:0,End:entries.length-1}[event.key];
        if (next===undefined) return;
        event.preventDefault();
        select((next+entries.length)%entries.length,true);
      });
    });
    return select;
  }
  const selectSource=tabs([[el('bilingual-tab'),el('settings')],[el('default-tab'),document.getElementById('speech-legacy-settings')]],
    index=>{if (index===0 && owner()) reloadProfiles();});
  const selectEditor=tabs([[el('reading-tab'),el('reading-settings')],[el('live-tab'),el('live-settings')]]);
  function liveConfig(config) {
    const live=config?.live;
    return Object.freeze({
      // Phase 1 routing predates Live settings and must stay on the native path.
      engine:live?.engine==='native' || config!=null && live===undefined ? 'native' : 'cascaded',
      turn_mode:live?.turn_mode==='ptt'?'ptt':'vad',
      barge_in:live?.barge_in!==false,
      stt_source:['voice','browser'].includes(live?.stt_source)?live.stt_source:'chat',
      stt_slot:names.includes(live?.stt_slot)?live.stt_slot:'primary',
      stt_language:['vi','ja'].includes(live?.stt_language)?live.stt_language:'auto'
    });
  }
  function layoutLive() {
    const native=liveEngine?.value==='native';
    if (liveOptions) liveOptions.hidden=native;
    for (const control of [liveTurn,liveBarge,liveStt,liveLanguage]) if (control) control.disabled=native;
    const hide=native || liveStt?.value!=='voice';
    if (liveSlotField) liveSlotField.hidden=hide;
    if (liveSlot) liveSlot.disabled=hide;
    if (browserSttHint) {
      const browser=!native && liveStt?.value==='browser';
      browserSttHint.hidden=!browser;
      if (browser) liveLanguage?.setAttribute('aria-describedby',browserSttHint.id);
      else liveLanguage?.removeAttribute('aria-describedby');
    }
  }
  function stored() {
    if (!owner()) return null;
    const raw=localStorage.getItem(prefix+owner());
    if (!raw) return null;
    const value=JSON.parse(raw);
    if (value?.version!==2 || !modes.includes(value.mode) || typeof value.admin_override!=='boolean') throw new Error('Cấu hình đã lưu không hợp lệ. Hãy lưu lại trong Âm thanh.');
    if (value.admin_override!==admin()) throw new Error('Quyền tài khoản đã thay đổi. Chọn lại nguồn giọng đọc.');
    // An empty speed input was previously saved as zero.
    for (const slot of ['ja','vi']) if (value[slot]?.speed===0) value[slot].speed=1;
    return value;
  }
  function renderSource(config,invalid=false) {
    el('active').textContent=invalid?'Cấu hình giọng đã lưu không dùng được':`Đang dùng: ${config?'Giọng song ngữ':'Giọng mặc định'}`;
    el('use-default').hidden=el('default-note').hidden=!config && !invalid;
    el('default-status').textContent='';
  }
  function save(value) {
    if (!owner()) throw new Error('Đăng nhập để chọn giọng đọc.');
    if (value) localStorage.setItem(prefix+owner(),JSON.stringify(value));
    else localStorage.removeItem(prefix+owner());
    renderSource(value);
    voiceChanged(value);
  }
  function input(parent,label,id,type='text') {
    const wrapper=document.createElement('label'), control=document.createElement(type==='select'?'select':'input');
    control.id='voice-v2-'+id;
    if (type!=='select') control.type=type;
    if (type==='checkbox') {
      const text=document.createElement('span');text.textContent=label;wrapper.append(control,text);
    } else {wrapper.textContent=label;wrapper.append(control);}
    parent.append(wrapper);
    return control;
  }
  function option(value,label) {
    const node=document.createElement('option');node.value=value;node.textContent=label;return node;
  }
  function redrawAccounts() {
    for (const [slot,control] of controls) {
      const selected=control.profile.value;
      control.profile.replaceChildren(option('',slot==='primary'?'Chọn kết nối đã lưu':'Dùng kết nối chính'));
      for (const row of rows) control.profile.append(option(ref(row),row.name));
      if (selected && !rows.some(row=>ref(row)===selected)) control.profile.append(option(selected,'Kết nối không còn dùng được'));
      control.profile.value=selected;
    }
  }
  function layout() {
    const single=mode.value==='single', split=mode.value==='dual_split_api';
    for (const [slot,control] of controls) {
      const primary=slot==='primary';
      control.section.hidden=!primary && single;
      control.section.dataset.compact=String(primary && !single);
      control.profile.parentElement.hidden=!primary && !split;
      control.profile.disabled=control.profile.parentElement.hidden || control.section.hidden;
      control.speed.disabled=primary ? !single : control.section.hidden;
      control.speed.parentElement.hidden=control.speed.disabled;
      if (primary) {
        control.fallback.hidden=single;
        control.fields.hidden=control.tuning.hidden=!single && !control.fallbackOpen;
      }
      control.headerText.textContent=primary && !single?(split?'Kết nối dự phòng':'Kết nối dùng chung'):'Kết nối';
      control.header.hidden=control.profile.parentElement.hidden;
      const useMain=!primary && (!split || !control.profile.value);
      if (!primary) control.model.placeholder=control.voice.placeholder=useMain?'Dùng chung':'Mặc định';
      control.catalog.hidden=useMain;
      control.catalogStatus.hidden=useMain || control.section.hidden;
      if (control.catalogStatus.hidden) control.catalogStatus.textContent='';
      control.model.setAttribute('list',useMain?controls.get('primary').modelList.id:control.modelList.id);
      control.voice.setAttribute('list',useMain?controls.get('primary').voiceList.id:control.voiceList.id);
      for (const field of [control.model,control.voice,control.reading]) if (field) field.disabled=control.section.hidden;
    }
  }
  function effectiveAccount(slot) {
    const {profile}=controls.get(slot);
    return (!profile.disabled && profile.value) || controls.get('primary').profile.value;
  }
  const draftKey=(reference,endpoint)=>JSON.stringify([reference,endpoint]);
  function rememberDrafts() {
    for (const [slot,control] of controls) {
      if (slot==='primary' || control.section.hidden) continue;
      const previous=selectedAccounts.get(slot);
      if (!previous?.reference) continue;
      if (!drafts.has(slot)) drafts.set(slot,new Map());
      drafts.get(slot).set(draftKey(previous.reference,previous.endpoint),
        [control.model.value,control.voice.value,control.nativeSpeed.checked]);
    }
  }
  function updateMistralHints() {
    const primary=controls.get('primary');
    const defaults=mode.value==='dual_same_api' && !primary.voice.value.trim()
      && rows.some(row=>ref(row)===primary.profile.value && provider(row)==='mistral');
    for (const lang of ['ja','vi']) {
      const {voice,presetHint}=controls.get(lang);
      presetHint.hidden=!defaults || Boolean(voice.value.trim());
      voice.setAttribute('aria-describedby',presetHint.hidden ? '' : presetHint.id);
    }
  }
  function updateAccounts(reset=false,modeSwitch=false) {
    for (const [slot,control] of controls) {
      if (!reset && control.section.hidden) continue;
      const reference=effectiveAccount(slot);
      const previous=selectedAccounts.get(slot), row=rows.find(row=>ref(row)===reference);
      const custom=row?.protocol==='openai_compatible' && !control.profile.disabled && Boolean(control.profile.value);
      control.nativeSpeed.parentElement.hidden=!custom;
      control.nativeSpeed.disabled=!custom || control.section.hidden;
      const endpoint=row ? JSON.stringify([provider(row),row.base_url]) : null;
      const revision=row ? JSON.stringify(fingerprint(row)) : null;
      const changed=reference!==previous?.reference || (endpoint && previous?.endpoint && endpoint!==previous.endpoint);
      if (reset || changed || revision!==previous?.revision) {
        if (!reset && changed) {
          if (!modeSwitch && previous?.reference===reference) {
            const key=draftKey(previous.reference,previous.endpoint);
            if (slot==='primary') for (const parked of drafts.values()) parked.delete(key);
            else drafts.get(slot)?.delete(key);
          }
          const saved=modeSwitch?drafts.get(slot)?.get(draftKey(reference,endpoint)):null;
          [control.model.value,control.voice.value,control.nativeSpeed.checked]=saved || ['','',false];
        }
        control.modelList.replaceChildren();control.voiceList.replaceChildren();
        control.catalog.textContent='Tải danh mục';
        control.catalogStatus.textContent='';
        catalogs.delete(slot);
        selectedAccounts.set(slot,{reference,endpoint:endpoint || (!changed && previous?.endpoint),revision});
      }
    }
    const row=rows.find(row=>ref(row)===controls.get('primary').profile.value);
    el('remove').hidden=!row || Boolean(row.model);
    updateMistralHints();
  }
  for (const [slot,title] of Object.entries(titles)) {
    const section=document.createElement('fieldset'), legend=document.createElement('legend');
    legend.textContent=title;section.append(legend);slots.append(section);
    const header=document.createElement('div');header.className='sound-slot-header';section.append(header);
    const profile=input(header,'',slot+'-profile','select'), headerText=document.createElement('span');
    profile.parentElement.prepend(headerText);
    const catalogStatus=document.createElement('p');
    catalogStatus.id='voice-v2-'+slot+'-catalog-status';catalogStatus.className='ai-field-hint';
    catalogStatus.setAttribute('role','status');section.append(catalogStatus);
    const fields=document.createElement('div');fields.className='sound-ids';section.append(fields);
    const voice=input(fields,'ID giọng',slot+'-voice');voice.maxLength=100;
    voice.placeholder='Mặc định';
    const model=input(fields,'ID model',slot+'-model');model.maxLength=100;
    model.placeholder='Mặc định';
    const modelList=document.createElement('datalist'), voiceList=document.createElement('datalist');
    modelList.id='voice-v2-models-'+slot;voiceList.id='voice-v2-voices-'+slot;
    model.setAttribute('list',modelList.id);voice.setAttribute('list',voiceList.id);section.append(modelList,voiceList);
    const presetHint=slot==='primary' ? null : document.createElement('p');
    if (presetHint) {
      presetHint.id='voice-v2-'+slot+'-preset-hint';presetHint.className='ai-field-hint';presetHint.hidden=true;
      presetHint.textContent=`Chưa nhập ID giọng. Mistral sẽ dùng ${mistralPresets[slot]} mặc định.`;
      section.append(presetHint);
    }
    const tuning=document.createElement('details'), summary=document.createElement('summary'), advanced=document.createElement('div');
    tuning.className='sound-tuning';advanced.className='sound-fields';
    summary.textContent=slot==='vi'?'Tinh chỉnh tốc độ':'Tinh chỉnh tốc độ và Kanji';
    tuning.append(summary,advanced);section.append(tuning);
    let fallback;
    if (slot==='primary') {
      fields.id='voice-v2-primary-ids';tuning.id='voice-v2-primary-tuning';
      fallback=document.createElement('button');fallback.type='button';fallback.className='settings-link';
      fallback.id='voice-v2-primary-fallback';fallback.textContent='Tùy chỉnh';
      fallback.setAttribute('aria-controls',`${fields.id} ${tuning.id}`);
      fallback.setAttribute('aria-expanded','false');
      fallback.addEventListener('click',()=>{
        const control=controls.get(slot);
        control.fallbackOpen=!control.fallbackOpen;
        fallback.setAttribute('aria-expanded',String(control.fallbackOpen));
        layout();
      });
    }
    const speed=input(advanced,'Tốc độ phát',slot+'-speed','number');
    Object.assign(speed,{min:'0.5',max:'2',step:'0.01',value:'1'});
    const reading=slot!=='vi' ? input(advanced,'Cách đọc Kanji',slot+'-reading','select') : null;
    const nativeSpeed=input(advanced,'Máy chủ tùy chỉnh hỗ trợ chỉnh tốc độ',slot+'-native-speed','checkbox');
    nativeSpeed.parentElement.className='sound-full';
    reading?.append(option('kanji_native','Giữ Kanji'),option('kana_first','Ưu tiên kana'));
    const catalog=document.createElement('button');catalog.type='button';catalog.id='voice-v2-'+slot+'-catalog';catalog.className='settings-link';catalog.textContent='Tải danh mục';header.append(catalog);
    if (fallback) header.append(fallback);
    controls.set(slot,{section,header,headerText,fields,tuning,profile,model,voice,speed,nativeSpeed,reading,catalog,catalogStatus,modelList,voiceList,presetHint,fallback,fallbackOpen:false});
    voice.addEventListener('input',updateMistralHints);
    voice.addEventListener('change',updateMistralHints);
    catalog.addEventListener('click',()=>loadCatalog(slot));
    profile.addEventListener('change',()=>{layout();updateAccounts();});
  }
  function capture() {
    const config={version:2,mode:mode.value,admin_override:admin()};
    config.live=liveConfig({live:{
      engine:liveEngine?.value ?? restoredLive.engine,
      turn_mode:liveTurn?.value ?? restoredLive.turn_mode,
      barge_in:liveBarge ? liveBarge.checked : restoredLive.barge_in,
      stt_source:liveStt?.value ?? restoredLive.stt_source,
      stt_slot:liveSlot?.value ?? restoredLive.stt_slot,
      stt_language:liveLanguage?.value ?? restoredLive.stt_language
    }});
    for (const [slot,control] of controls) {
      if (slot!=='primary' && config.mode==='single') continue;
      const reference=control.profile.disabled ? '' : control.profile.value;
      const row=rows.find(row=>ref(row)===reference);
      if ((slot==='primary' || reference) && !row) throw new Error('Chọn kết nối đã lưu cho '+titles[slot]+'.');
      const settings={profile:row ? {scope:row.scope,id:row.id} : null};
      if (row) settings.provider=provider(row);
      const model=control.model.value.trim(), voice=control.voice.value.trim();
      if (model) settings.model=model;
      if (voice) settings.voice_id=voice;
      if (!control.nativeSpeed.disabled && control.nativeSpeed.checked) settings.native_speed=true;
      const speed=control.speed.value==='' ? 1 : Number(control.speed.value);
      if (!Number.isFinite(speed) || speed<0.5 || speed>2) {
        if (!control.speed.disabled) throw new Error('Tốc độ phải từ 0.5 đến 2.');
      } else if (slot!=='primary' || speed!==1) {
        // Dual slots always save their own speed; retain the primary value for single mode.
        settings.speed=speed;
      }
      if (control.reading) settings.kanji_mode=control.reading.value;
      config[slot]=settings;
    }
    const live=config.live;
    if (live.engine==='cascaded' && live.stt_source==='voice') {
      try {sttProfileName(config,live.stt_slot);}
      catch (error) {
        selectEditor(1);
        liveStt.focus();
        throw error;
      }
    }
    for (const [lang,slot] of Object.entries(config.mode==='single' ? {ja:config.primary,vi:config.primary} : {ja:config.ja,vi:config.vi})) {
      const effective=slot.profile ? slot : {...config.primary,...slot,provider:config.primary.provider};
      if (['elevenlabs','openai_compatible'].includes(effective.provider) || effective.provider==='mistral' && config.mode==='single') {
        if (!effective.voice_id) throw new Error(`Nhập ID giọng cho ${titles[lang]}.`);
      }
      if (effective.provider==='openai_compatible' && !effective.model) throw new Error(`Nhập ID model cho ${titles[lang]}.`);
      if (effective.provider==='elevenlabs' && lang==='vi' && effective.model==='eleven_multilingual_v2')
        throw new Error('Eleven Multilingual v2 không hỗ trợ tiếng Việt. Chọn model khác.');
    }
    return config;
  }
  function restore() {
    redrawAccounts();
    let config,invalid=false;
    try {config=stored();}
    catch (error) {invalid=true;status.textContent=error.message;}
    renderSource(config,invalid);
    mode.value=config?.mode || 'single';
    restoredLive=liveConfig(config);
    if (liveEngine) liveEngine.value=restoredLive.engine;
    if (liveTurn) liveTurn.value=restoredLive.turn_mode;
    if (liveBarge) liveBarge.checked=restoredLive.barge_in;
    if (liveStt) liveStt.value=restoredLive.stt_source;
    if (liveSlot) liveSlot.value=restoredLive.stt_slot;
    if (liveLanguage) liveLanguage.value=restoredLive.stt_language;
    layoutLive();
    for (const [slot,control] of controls) {
      const value=config?.[slot] || {};
      if (value.profile) {
        const key=ref(value.profile);
        if (!rows.some(row=>ref(row)===key)) control.profile.append(option(key,'Kết nối không còn dùng được'));
        control.profile.value=key;
      } else control.profile.value='';
      control.model.value=value.model || '';control.voice.value=value.voice_id || '';
      control.speed.value=value.speed ?? 1;
      control.nativeSpeed.checked=value.native_speed===true;
      if (control.reading) control.reading.value=value.kanji_mode || 'kanji_native';
    }
    const primary=controls.get('primary');
    primary.fallbackOpen=false;primary.fallback.setAttribute('aria-expanded','false');
    layout();
    drafts.clear();catalogs.clear();updateAccounts(true);
    return config;
  }
  const rowFor=(profile,kind)=>rows.find(row=>ref(row)===ref(profile) && provider(row)===kind);
  const changed=()=>new Error('Kết nối giọng nói đã đổi hoặc đã bị xóa.');
  function assertRole(config) {
    if (!owner() || config?.admin_override!==admin()) throw new Error('Quyền tài khoản đã đổi. Chọn lại nguồn giọng đọc.');
  }
  function profileRows(config,slots) {
    if (metadataRole!==roleKey()) throw new Error('Chưa tải được danh sách kết nối giọng nói.');
    return slots.flatMap(name=>{
      const slot=config[name];
      if (!slot?.profile) return [];
      const {scope,id}=slot.profile, kind=slot.provider, profile={scope,id};
      const row=rowFor(profile,kind);
      if (!row) throw changed();
      return [{name,profile,kind,row,fingerprint:JSON.stringify(fingerprint(row))}];
    });
  }
  async function confirmProfiles(config,slots,signal,{replay=false,verifyLocal=false}={}) {
    assertRole(config);
    const role=roleKey(), user=owner(), revision=routingRevision;
    signal?.throwIfAborted();
    const targets=profileRows(config,slots), loaded=new Map(), profiles=new Map();
    const check=()=>{
      signal?.throwIfAborted();
      if (roleKey()!==role || revision!==routingRevision || metadataRole!==role) throw changed();
      for (const target of targets) {
        const row=rowFor(target.profile,target.kind);
        if (!row || JSON.stringify(fingerprint(row))!==target.fingerprint) throw changed();
      }
    };
    function unavailable() {
      void reloadProfiles()?.catch(()=>{});
      throw changed();
    }
    let server;
    if (targets.some(({profile})=>profile.scope==='server')) {
      const response=await apiFetch('/api/ai/profiles',{signal});
      check();
      if (!response.ok) throw new Error('Chưa kiểm tra được kết nối giọng nói trên máy chủ.');
      const data=await response.json();
      check();
      if (!Array.isArray(data.profiles)) throw changed();
      server=new Map(data.profiles.map(row=>[row.id,row]));
    }
    for (const {name,profile,kind,row} of targets) {
      if (profile.scope==='server') {
        const latest=server.get(profile.id);
        if (!latest?.connection_id || latest.connection_id!==row.connection_id || latest.base_url!==row.base_url || provider(latest)!==kind) unavailable();
        profiles.set(name,profile);
      } else if (profile.scope==='local') {
        const matches=value=>value && provider(value)===kind && value.base_url===row.base_url && value.revision===row.revision;
        let value=loaded.get(profile.id);
        if (!value) {
          value=await (replay ? VJProfiles.metadata(user,profile.id) : VJProfiles.load(user,profile.id));
          check();
          if (!matches(value)) unavailable();
          if (verifyLocal) {
            const latest=await VJProfiles.metadata(user,profile.id);
            check();
            if (!matches(latest)) unavailable();
          }
          loaded.set(profile.id,value);
        }
        if (!replay) profiles.set(name,{scope:'local',connection:{base_url:value.base_url,api_key:value.api_key}});
      } else throw changed();
    }
    return {profiles,check};
  }
  async function prepared(config,signal,{replay=false}={}) {
    const result={...config}, {profiles,check}=await confirmProfiles(config,names,signal,{replay});
    check();
    for (const [name,profile] of profiles) if (profile.scope==='local') result[name]={...result[name],profile};
    return result;
  }
  function sttProfileName(config,slot) {
    // An unset split slot shares the configured primary account, just like read-aloud.
    const name=config.mode==='dual_split_api' && config[slot]?.profile!=null ? slot : 'primary';
    const selected=config[name];
    if (!selected?.profile || !sttProviders.includes(selected.provider)) throw new Error('Chọn kết nối OpenAI, Mistral hoặc ElevenLabs để chép lời.');
    return name;
  }
  async function preparedStt(config,signal) {
    const live=liveConfig(config);
    if (live.stt_source!=='voice') return null;
    assertRole(config);
    if (config.version!==2 || !modes.includes(config.mode)) throw changed();
    const name=sttProfileName(config,live.stt_slot);
    const kind=config[name].provider, override=config.admin_override, user=owner();
    const saved=localStorage.getItem(prefix+user);
    const {profiles,check}=await confirmProfiles(config,[name],signal,{verifyLocal:true});
    check();
    if (saved!==localStorage.getItem(prefix+user)) throw changed();
    return {version:2,admin_override:override,provider:kind,profile:profiles.get(name)};
  }
  function audioIdentity(config,legacy=false) {
    assertRole(config);
    const profiles=profileRows(config,names);
    const audio={version:config.version,mode:config.mode,admin_override:config.admin_override};
    for (const name of names) {
      const slot=config[name];
      if (!slot) continue;
      const {provider,model,voice_id,native_speed,speed,kanji_mode}=slot;
      const profile=profiles.find(item=>item.name===name)?.profile ?? slot.profile;
      audio[name]={profile,provider,model,voice_id,native_speed,speed,kanji_mode};
    }
    return JSON.stringify([roleKey(),audio,...profiles.map(({row})=>[row.base_url,row.connection_id,legacy?row.key_last4:null,row.revision])]);
  }
  const identity=config=>audioIdentity(config);
  async function legacyCacheKey(config,text,reference) {
    // Only the digest leaves this compatibility lookup; the suffix is not part of the current identity.
    return window.VJVoiceCache.key(audioIdentity(config,true),text,reference);
  }
  const liveIdentity=config=>JSON.stringify([identity(config),liveConfig(config)]);
  async function loadCatalog(slot) {
    if (busy) return;
    const control=controls.get(slot), role=roleKey(), selection=selectedAccounts.get(slot), notice=control.catalogStatus;
    const current=()=>!notice.hidden && role===roleKey() && selection===selectedAccounts.get(slot);
    if (!current()) return;
    busy=true;control.catalog.disabled=true;
    try {
      const selectedRef=effectiveAccount(slot);
      const row=rows.find(row=>ref(row)===selectedRef);
      if (!row) throw new Error('Chọn kết nối đã lưu cho '+titles[slot]+'.');
      const config={version:2,mode:'single',admin_override:admin(),primary:{profile:{scope:row.scope,id:row.id},provider:provider(row)}};
      const start=identity(config), cached=catalogs.get(slot);
      const all=cached?.identity===start ? cached : {identity:start,models:new Map(),voices:new Map()};
      notice.textContent='Đang tải giọng và model. Không tạo âm thanh.';
      const routing=await prepared(config);
      if (!current()) return;
      const response=await apiFetch('/api/tts',{voiceRouting:true,method:'POST',headers:{'Content-Type':'application/json'},
        signal:AbortSignal.timeout(30000),body:JSON.stringify({action:'catalog',routing,...(all.cursor?{cursor:all.cursor}:{})})});
      const data=await response.json();
      if (!current() || start!==identity(config)) return;
      if (!response.ok) {
        if (response.status===403 && data.code==='tts_catalog_permission' && config.primary.provider==='elevenlabs')
          throw new Error('Cấp quyền đọc giọng và model trên ElevenLabs hoặc nhập tay ID giọng. Ở ô ID model, để trống hoặc nhập eleven_v3 hay eleven_turbo_v2_5.');
        throw new Error(data.detail || 'Không tải được giọng và model.');
      }
      if (!Array.isArray(data.models) || !Array.isArray(data.voices)) throw new Error('Danh sách giọng không hợp lệ.');
      for (const row of data.models) all.models.set(row.id,row);
      for (const row of data.voices) all.voices.set(row.id,row);
      all.cursor=data.next_cursor;
      catalogs.set(slot,all);
      control.modelList.replaceChildren(...[...all.models.values()].map(row=>{
        const hint=config.primary.provider==='elevenlabs' && Object.hasOwn(elevenModelHints,row.id) ? elevenModelHints[row.id] : null;
        return option(row.id,[hint,...(row.languages ?? [])].filter(Boolean).join(' · ') || row.id);
      }));
      control.voiceList.replaceChildren(...[...all.voices.values()].map(row=>{
        const preset=config.primary.provider==='mistral' ? mistralPresets[row.lang] : null;
        return option(row.id,row.category==='cloned' ? `${row.name} · Giọng nhân bản` : preset || row.name);
      }));
      control.catalog.textContent=all.cursor?'Tải thêm giọng':'Tải danh mục';
      notice.textContent=`${all.models.size} model · ${all.voices.size} giọng${all.cursor?' · còn kết quả':''}. Chưa thử tạo âm thanh.`;
    } catch (error) {if (current()) notice.textContent=error.message;}
    finally {busy=false;control.catalog.disabled=false;}
  }
  function activeIdentity() {
    try {
      const config=stored();
      return config ? identity(config) : null;
    } catch {return null;}
  }
  const old=window.renderVoiceProfiles;
  window.renderVoiceProfiles=(user,data,canStore,platform,profilesLoaded=false)=>{
    old?.(user,data,canStore,platform);
    if (user!==owner() || admin() && !profilesLoaded) return;
    const previous=activeIdentity();
    metadataRole=roleKey();rows=data.filter(row=>Object.hasOwn(bases,provider(row)) && (row.protocol!=='openai' || [bases.openai,bases.mistral].includes(row.base_url)) && (row.protocol!=='gemini' || row.base_url===bases.gemini));
    el('storage').options[1].disabled=!canStore;
    if (drawnIdentity!==roleKey()) {drawnIdentity=roleKey();restore();} else {redrawAccounts();updateAccounts();}
    if (previous!==activeIdentity()) {
      let current;
      try {current=stored();} catch { /* An invalid configuration was already revoked. */ }
      voiceChanged(current);
    }
  };
  function cancelRemoval() {pendingRemoval?.abort();pendingRemoval=null;}
  function confirmRemoval(row, signal) {
    const dialog=el('confirm-dialog');
    if (!dialog?.showModal || signal.aborted) return Promise.resolve(false);
    const title=el('confirm-title'), description=el('confirm-description');
    if (title) title.textContent=`Xóa kết nối ${row.name}?`;
    if (description) description.textContent=`Xóa ${row.name} khỏi ${row.scope==='local'?'thiết bị này':'máy chủ'}? Các cấu hình đang dùng kết nối này sẽ ngừng phát cho đến khi chọn lại.`;
    dialog.returnValue='';
    return new Promise(resolve=>{
      const cancel=()=>{if (dialog.open) dialog.close('cancel');};
      dialog.addEventListener('close',()=>{
        signal.removeEventListener('abort',cancel);
        resolve(!signal.aborted && dialog.returnValue==='delete');
      },{once:true});
      signal.addEventListener('abort',cancel,{once:true});
      dialog.showModal();
    });
  }
  el('use-default').addEventListener('click',()=>{
    const message=el('default-status');
    try {
      cancelRemoval();save(null);el('default-tab').focus();
      message.textContent='Đang dùng giọng mặc định. Các kết nối giọng nói vẫn được giữ.';
    } catch (error) {message.textContent=error.message;}
  });
  mode.addEventListener('change',()=>{rememberDrafts();layout();updateAccounts(false,true);});
  liveEngine?.addEventListener('change',layoutLive);
  liveStt?.addEventListener('change',layoutLive);
  const account=el('account'), accountDialog=el('account-dialog'), accountStatus=el('account-status'),
    key=el('key'), keyToggle=el('key-toggle'), urlField=el('url-field');
  function showKey(show) {
    key.type=show?'text':'password';
    keyToggle.textContent=show?'Ẩn':'Hiện';
    keyToggle.setAttribute('aria-label',show?'Ẩn khóa API':'Hiện khóa API');
    keyToggle.setAttribute('aria-pressed',String(show));
  }
  function layoutUrl() {
    url.required=kind.value==='openai_compatible';
    url.disabled=urlField.hidden=!url.required;
    if (url.disabled) url.value='';
  }
  function closeAccount(restoreFocus=false) {
    if (!accountDialog.open) return;
    account.reset();showKey(false);layoutUrl();accountStatus.textContent='';
    accountOwner=null;
    accountDialog.close();
    if (restoreFocus) el('add').focus();
  }
  kind.addEventListener('change',layoutUrl);
  keyToggle.addEventListener('click',()=>showKey(key.type==='password'));
  el('add').addEventListener('click',()=>{
    if (!owner() || busy) return;
    accountOwner=roleKey();
    accountDialog.showModal();
    el('name').focus();
  });
  el('account-cancel').addEventListener('click',()=>closeAccount(true));
  accountDialog.addEventListener('cancel',event=>{event.preventDefault();closeAccount(true);});
  account.addEventListener('submit',async event=>{
    event.preventDefault();if (busy) return;
    const user=owner(), role=roleKey(), button=event.submitter;
    busy=true;if (button) button.disabled=true;
    accountStatus.textContent='Đang lưu kết nối…';
    try {
      const result=await window.saveVoiceProfile(user,{version:2,name:el('name').value.trim(),protocol:kind.value,
        base_url:url.disabled?undefined:url.value.trim(),api_key:key.value.trim()},el('storage').value);
      if (role!==roleKey() || !accountDialog.open) return;
      if (!controls.get('primary').profile.value) controls.get('primary').profile.value=ref(result);
      layout();
      updateAccounts();
      closeAccount();status.textContent='Đã lưu kết nối. Chọn giọng rồi lưu cấu hình.';
    } catch (error) {if (role===roleKey() && accountDialog.open) accountStatus.textContent=error.message;}
    finally {busy=false;if (button) button.disabled=false;}
  });
  el('remove').addEventListener('click',async()=>{
    if (busy) return;
    const row=rows.find(row=>ref(row)===controls.get('primary').profile.value);
    if (!row || row.model) {status.textContent='Chọn một kết nối giọng nói riêng để xóa.';return;}
    const user=owner(), role=roleKey(), abort=pendingRemoval=new AbortController();
    busy=true;
    try {
      if (!(await confirmRemoval(row,abort.signal))) return;
      if (role!==roleKey() || abort.signal.aborted || !rows.some(item=>ref(item)===ref(row))) return;
      const restoreFocus=document.activeElement===el('remove');
      await window.removeVoiceProfile(user,row.scope,row.id);
      if (role===roleKey()) {
        if (restoreFocus && el('remove').hidden && [document.body,el('remove')].includes(document.activeElement)) controls.get('primary').profile.focus();
        status.textContent='Đã xóa kết nối giọng nói. Chọn lại nếu cấu hình đang dùng kết nối này.';
      }
    } catch (error) {if (role===roleKey()) status.textContent=error.message;}
    finally {if (pendingRemoval===abort) pendingRemoval=null;busy=false;}
  });
  el('routing').addEventListener('invalid',event=>{
    selectEditor(0);
    const disclosure=event.target.closest('details');
    if (disclosure) disclosure.open=true;
  },true);
  el('routing').addEventListener('submit',event=>{
    event.preventDefault();
    try {save(capture());status.textContent='Đã lưu cấu hình song ngữ.';}
    catch (error) {status.textContent=error.message;}
  });
  el('preview').addEventListener('click',()=>{
    try {
      const config=stored();
      if (!config || identity(capture())!==identity(config)) throw new Error('Lưu cấu hình trước khi nghe thử.');
      window.VJVoice.speak('Xin chào! こんにちは、いっしょに練習しましょう。',{preview:true});
    } catch (error) {status.textContent=error.message;}
  });
  const closeDialogs=()=>{cancelRemoval();closeAccount();};
  for (const event of ['pagehide','hashchange','popstate']) window.addEventListener(event,closeDialogs);
  window.addEventListener('vjbot-voice-changed',()=>{
    routingRevision++;
    if (accountDialog.open && accountOwner!==roleKey()) closeAccount();
  });
  window.addEventListener('vjbot-account-ready',()=>{
    if (accountDialog.open && accountOwner!==roleKey()) closeAccount();
    if (drawnIdentity===roleKey()) return;
    closeDialogs();
    status.textContent='';
    routingRevision++;metadataRole=null;rows=[];catalogs.clear();drawnIdentity=roleKey();
    const config=restore();
    if (admin() && !config) selectSource(1);
    else if (owner() && (config || !el('settings').hidden)) reloadProfiles();
  });
  window.addEventListener('storage',event=>{
    if (owner() && (event.key===prefix+owner() || event.key===null)) {
      restore();voiceChanged({live:restoredLive});
    }
  });
  window.VJVoiceRouting=Object.freeze({stored,prepared,identity,legacyCacheKey,liveIdentity,liveConfig,preparedStt});
  restore();
})();
