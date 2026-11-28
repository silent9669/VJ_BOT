(function () {
  const maxLine=7 * 1024 * 1024;
  const maxStream=Math.ceil(5 * 1024 * 1024 / 3) * 4 + 65536;
  // Matches the Worker synthesis budget in src/voice/segmenter.js.
  const maxSegments=16;
  async function consume(response, append, current, signal) {
    if (!current()) {
      void response.body?.cancel().catch(()=>{});
      return null;
    }
    const failed=!response.ok, missing='Không đọc được đoạn này.';
    if (!response.body || !failed && !response.headers.get('Content-Type')?.startsWith('application/x-ndjson')) {
      void response.body?.cancel().catch(()=>{});
      throw new Error(failed ? missing : 'Phản hồi âm thanh không hợp lệ.');
    }
    const reader=response.body.getReader(), decoder=new TextDecoder('utf-8',{fatal:true});
    const segments=[];
    let pending='', ended=false, complete=false, bytes=0;
    const cancel=()=>{void reader.cancel().catch(()=>{});};
    signal?.addEventListener('abort',cancel,{once:true});
    try {
      for (;;) {
        const {done,value}=await reader.read();
        if (!current()) return null;
        bytes+=value?.byteLength || 0;
        if (failed && bytes>32*1024) throw new Error(missing);
        if (bytes>maxStream) throw new Error('Phản hồi âm thanh quá lớn.');
        pending+=done ? decoder.decode() : decoder.decode(value,{stream:true});
        if (failed) {
          if (!done) continue;
          let problem;
          try {problem=JSON.parse(pending);} catch {throw new Error(missing);}
          throw new Error(typeof problem?.detail==='string' && problem.detail.trim() ? problem.detail.slice(0,600) : missing);
        }
        let position;
        while ((position=pending.indexOf('\n'))!==-1) {
          if (position>maxLine || ended) throw new Error('Phản hồi âm thanh không hợp lệ.');
          const record=JSON.parse(pending.slice(0,position));pending=pending.slice(position+1);
          if (record.type==='error') throw new Error(record.detail || 'Không đọc được đoạn này.');
          if (record.type==='done' && segments.length && record.count===segments.length) {ended=true;continue;}
          if (record.type!=='segment' || record.index!==segments.length || segments.length>=maxSegments
            || !['ja','vi'].includes(record.lang) || !['start','inline','sentence','arrow','blank'].includes(record.boundary)
            || record.boundary==='blank' && record.index===0
            || typeof record.speed!=='number' || record.speed<0.5 || record.speed>2
            || typeof record.audioBase64!=='string' || !record.audioBase64) throw new Error('Đoạn âm thanh không hợp lệ.');
          segments.push(record);
          await append(record);
          if (!current()) return null;
        }
        if (pending.length>maxLine) throw new Error('Đoạn âm thanh quá lớn.');
        if (done) break;
      }
      if (pending || !ended) throw new Error('Âm thanh chưa tải xong. Bấm Nghe để thử lại.');
      complete=true;
      return segments;
    } finally {
      signal?.removeEventListener('abort',cancel);
      if (!complete) cancel();
      reader.releaseLock();
    }
  }
  let selected;
  function stop() {
    const previous=selected;selected=null;
    if (previous) {previous.controller.abort();previous.audio.stop();mascotMgr.setState('idle');}
  }
  async function speak(text, options={}) {
    let config;
    if (options.legacyVoice) return playLegacyTTS(text,options);
    try {config=window.VJVoiceRouting?.stored();}
    catch (error) {stopSpeech();speechStatus(error.message);return;}
    if (!config) return playLegacyTTS(text,{...options, japaneseOnly:options.mode==='ja' || options.japaneseOnly});
    stopSpeech();globalThis.stopJapaneseInputs?.();window.speechSynthesis?.cancel();
    text=String(text || '');
    if (!/\p{L}/u.test(text)) {speechStatus('Không có chữ để đọc.');return;}
    let state;
    try {
      const identity=window.VJVoiceRouting.identity(config);
      const controller=new AbortController(), audio=window.VJVoiceStitcher.create();
      state=selected={controller,audio};
      const current=()=>{
        if (selected!==state || controller.signal.aborted) return false;
        try {
          if (identity===window.VJVoiceRouting.identity(window.VJVoiceRouting.stored())) return true;
        } catch { /* An unavailable profile cannot keep playing. */ }
        stopSpeech();return false;
      };
      speechStatus('Đang chuẩn bị âm thanh…',true);
      const mode=options.mode || (options.japaneseOnly || options.language==='ja-JP' ? 'ja' : 'bilingual');
      const reference={mode,reading:mode==='ja'?options.reading:undefined};
      const context=options.preview ? null : options.lesson ? options : globalThis.teacherContext?.();
      if (context?.lesson) {
        Object.assign(reference,{lesson:context.lesson,focus:context.focus || null,view:context.view || 'checks'});
        if (context.task) reference.task=await taskReference(context.task);
      }
      if (!current()) return;
      const cache=window.VJVoiceCache, persist=options.cacheAudio===true && !options.privateAudio && !options.preview && !config.admin_override;
      const cacheKey=await cache.key(identity,text,reference).catch(()=>null);
      let hit=cacheKey ? await cache.get(cacheKey,persist) : null, fromLegacy=false;
      if (!current()) return;
      if (!hit && cacheKey && persist) {
        const legacyKey=await window.VJVoiceRouting.legacyCacheKey?.(config,text,reference).catch(()=>null);
        if (!current()) return;
        if (legacyKey && legacyKey!==cacheKey) {
          hit=await cache.get(legacyKey,true);
          fromLegacy=Boolean(hit);
        }
        if (!current()) return;
      }
      // Keep profile revocation checks on replay; only a cache miss needs local key decryption.
      const routing=await window.VJVoiceRouting.prepared(config,controller.signal,{replay:Boolean(hit)});
      if (!current()) return;
      async function append(segment) {
        await audio.append(segment);
        if (current()) {mascotMgr.setState('speaking');speechStatus('Đang đọc · '+(segment.lang==='ja'?'Tiếng Nhật':'Tiếng Việt'),true);}
      }
      if (hit) {
        if (fromLegacy) void cache.put(cacheKey,hit,persist);
        for (const segment of hit) {if (!current()) return;await append(segment);}
      } else {
        const response=await apiFetch('/api/tts',{voiceRouting:true,method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json'},
          body:JSON.stringify({...reference,text,stream:true,routing})});
        const segments=await consume(response,append,current,controller.signal);
        if (segments && current() && cacheKey) void cache.put(cacheKey,segments,persist);
      }
      if (!current()) return;
      await audio.finish();
      if (current()) stopSpeech();
    } catch (error) {
      if (state && state!==selected) return;
      stopSpeech();
      speechStatus(error.name==='NotAllowedError' ? 'Trình duyệt chặn phát âm thanh. Bấm Nghe lại.' : error.message || 'Chưa phát được âm thanh.');
    }
  }
  window.addEventListener('vjbot-account-ready',()=>window.VJVoiceCache.clearMemory());
  window.VJVoice=Object.freeze({speak,stop,consume});
})();
