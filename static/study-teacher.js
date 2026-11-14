// Generated presentation never replaces canonical exercise values or answer keys.
(function () {
  const active = new Set();
  function identity() {
    try {
      const owner = typeof signedInUser === 'undefined' ? null : signedInUser?.user_id;
      if (typeof signedInUser !== 'undefined' && signedInUser?.is_admin === true) return JSON.stringify([owner,location.hash,'platform']);
      return JSON.stringify([owner,location.hash,window.usesAntigravityOAuth?.(owner),
        window.antigravityConnectionId?.(owner),owner && window.VJProfiles?.active(owner),
        document.getElementById('ai-current-model')?.textContent || '']);
    } catch {return null;}
  }
  const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
  function refresh() {for (const entry of [...active]) entry.refresh();}
  for (const event of ['hashchange','popstate','pagehide','vjbot-account-ready','vjbot-ai-changed']) window.addEventListener(event,refresh);
  window.addEventListener('storage',refresh);
  const observer = new MutationObserver(refresh);
  observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden','open','class']});

  function teacherButton(text,type='button'){
    const button=document.createElement('button');
    button.type=type;button.className='study-teacher-button';button.textContent=text;
    return button;
  }

  globalThis.studyTarget = (key,element,source) => ({key,element,source:String(source ?? '')});
  globalThis.mountTeacherConversation = (host,{trigger,lesson,focus=null,view='checks',task=null,isCurrent=()=>true}) => {
    const box=document.createElement('section');box.className='study-teacher-chat';box.hidden=true;
    box.setAttribute('aria-label','Hỏi thầy Lâm');box.setAttribute('data-teacher-exclude','');
    const heading=document.createElement('strong');heading.textContent='Em muốn hỏi thầy điều gì?';
    const log=document.createElement('div');log.className='study-teacher-messages';log.setAttribute('role','log');log.setAttribute('aria-label','Trò chuyện với thầy Lâm');
    const form=document.createElement('form');form.className='study-teacher-compose';
    const label=document.createElement('label');label.textContent='Chỗ em chưa hiểu';
    const input=document.createElement('textarea');input.rows=2;input.maxLength=6000;input.required=true;
    input.placeholder='Ví dụ: Thầy giải thích giúp em vì sao dùng mẫu câu này nhé?';label.append(input);
    const actions=document.createElement('div');actions.className='study-teacher-chat-actions';
    const send=teacherButton('Gửi thầy','submit');
    const close=teacherButton('Để em thử lại');
    const retry=teacherButton('Gửi lại cho thầy');retry.hidden=true;
    const edit=teacherButton('Hỏi câu khác');edit.hidden=true;
    const status=document.createElement('p');status.className='study-teacher-status';status.setAttribute('role','status');
    actions.append(send,close,retry,edit);form.append(label,actions);box.append(heading,log,form,status);host.append(box);
    const route=`study/${crypto.randomUUID()}`;box.id=route.replace('/','-');
    trigger.setAttribute('aria-controls',box.id);trigger.setAttribute('aria-expanded','false');
    let controller=null,failed=null,ticket=null,disposed=false;
    const attempt=focusedTaskAttempt(lesson,focus,view,task);
    const live=()=>!disposed && box.isConnected && !box.hidden && isCurrent() && ticket===identity();
    function controls(busy=false){
      input.readOnly=busy || Boolean(failed);send.disabled=busy || Boolean(failed);retry.disabled=busy;
      retry.hidden=!failed;edit.hidden=!failed;edit.disabled=busy;form.setAttribute('aria-busy',String(busy));
    }
    function clear(){
      controller?.abort();controller=null;failed=null;ticket=null;box.hidden=true;
      log.replaceChildren();input.value='';status.textContent='';controls();trigger.setAttribute('aria-expanded','false');
    }
    function open(){
      if(disposed || !isCurrent())return;
      if(ticket && ticket!==identity())clear();
      ticket=identity();box.hidden=false;trigger.setAttribute('aria-expanded','true');input.focus();
    }
    function message(speaker,text){
      const row=document.createElement('p');row.className=`study-teacher-message ${speaker==='Em'?'is-learner':'is-teacher'}`;
      const name=document.createElement('strong');name.textContent=speaker;
      const content=document.createElement('span');content.textContent=text;row.append(name,content);log.append(row);
      row.scrollIntoView?.({block:'nearest'});
    }
    async function submit(retrying=false){
      if(controller || !live() || retrying && !failed || !retrying && failed)return;
      const text=input.value.trim();if(!retrying && !text){input.focus();return;}
      if(text.length>6000){status.textContent='Em viết câu hỏi trong 6.000 ký tự nhé.';return;}
      const request=retrying?failed:{body:null,text};
      const owner=ticket,requestController=new AbortController();controller=requestController;controls(true);
      status.textContent='Thầy đang đọc câu hỏi của em…';
      const current=()=>controller===requestController && !requestController.signal.aborted && live() && owner===ticket;
      try{
        if(!request.body){
          const body={message:request.text,lesson,focus,view,channel:'quick',intent:'message',
            screen:{route,title:'Hỏi thầy Lâm',level:lesson.level,text:''},request_id:crypto.randomUUID()};
          if(focus?.kind==='question'){
            if(!attempt)throw new Error('Chưa xác định đúng phiên bản câu hỏi. Mở lại bài.');
            await recordTaskEvent(attempt,'assist',{help:'chat'});
            body.task=await taskReference(attempt.task);request.task=body.task;
          }
          request.body=JSON.stringify(body);
        }
        if(!current())return;
        const response=await apiFetch('/api/chat',{method:'POST',signal:AbortSignal.any([requestController.signal,AbortSignal.timeout(35000)]),
          headers:{'Content-Type':'application/json'},body:request.body});
        const data=await response.json();if(!current())return;
        if(!response.ok)throw new Error(data.detail || 'Chưa gửi được câu hỏi. Em gửi lại cho thầy nhé.');
        const reply=data.reply || data.response;
        if(typeof reply!=='string' || !reply.trim())throw new Error('Chưa nhận được câu trả lời. Em gửi lại cho thầy nhé.');
        if(request.task && (data.task?.id!==request.task.id || data.task?.revision!==request.task.revision))throw new Error('Phản hồi thuộc phiên bản câu hỏi khác. Mở lại bài.');
        message('Em',request.text);message('Thầy Lâm',reply);failed=null;input.value='';status.textContent='';
      }catch(error){
        if(current()){failed=request;status.textContent=error.name==='TimeoutError'?'Kết nối hơi lâu. Em bấm gửi lại cho thầy nhé.':error.message || 'Chưa kết nối được với thầy.';}
      }finally{
        if(controller===requestController){controller=null;if(!live())clear();else controls();}
      }
    }
    form.onsubmit=event=>{event.preventDefault();return submit();};
    retry.onclick=()=>submit(true);
    edit.onclick=()=>{failed=null;status.textContent='';controls();input.focus();};
    close.onclick=()=>{clear();trigger.focus();};
    box.onkeydown=event=>{
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close.onclick();}
      else if(event.key==='Enter' && (event.ctrlKey || event.metaKey) && !event.isComposing){event.preventDefault();submit();}
    };
    const entry={refresh(){
      if(!box.isConnected){cleanup();return;}
      if(ticket && (!isCurrent() || ticket!==identity()))clear();
    }};
    function cleanup(){if(disposed)return;clear();disposed=true;active.delete(entry);box.remove();}
    active.add(entry);
    return {open,clear,cleanup};
  };
  globalThis.mountStudyTeacher = (host,{lesson,focus=null,view='checks',task=null,targets=[],isCurrent=()=>true,revealWhen=()=>true,onApply=()=>{}}) => {
    const panel=document.createElement('aside');panel.className='study-teacher';panel.setAttribute('aria-label','Học cùng thầy Lâm');panel.setAttribute('data-teacher-exclude','');
    const heading=document.createElement('strong');heading.className='study-teacher-title';heading.textContent='Cùng thầy Lâm hiểu bài';
    const button=teacherButton('Nhờ thầy giảng bài');
    const status=document.createElement('p');status.className='study-teacher-status';status.setAttribute('role','status');
    const output=document.createElement('p');output.className='study-teacher-reply';output.hidden=true;
    const generated=document.createElement('section');generated.className='study-generated-fields';generated.hidden=true;
    generated.setAttribute('aria-label','Bản diễn giải được tạo từ nguyên văn');
    const compare=teacherButton('Xem bản gốc');compare.hidden=true;
    panel.append(heading,button,status,output,compare,generated);host.append(panel);
    const bindings=targets.filter(target=>target.element && target.source.trim()).map(target=>({...target}));
    let controller=null,ticket=null,translated=null,disposed=false,showingGenerated=false;
    const attempt=focusedTaskAttempt(lesson,focus,view,task);
    const live=()=>!disposed && panel.isConnected && !panel.hidden && isCurrent();
    const conversation=mountTeacherConversation(panel,{trigger:button,lesson,focus,view,task,isCurrent:live});
    function restore() {
      for(const target of bindings)if(translated && target.element.textContent===translated.get(target.key))target.element.textContent=target.source;
      onApply(null);
      showingGenerated=false;compare.textContent='Xem bản diễn giải AI';
      generated.hidden=true;
    }
    function clear(message='') {
      controller?.abort();controller=null;ticket=null;
      restore();translated=null;conversation.clear();
      output.textContent='';output.hidden=true;status.textContent=message;
      generated.replaceChildren();generated.hidden=true;
      button.disabled=false;button.setAttribute('aria-busy','false');button.textContent='Nhờ thầy giảng bài';
      compare.hidden=true;
    }
    const entry={refresh(){
      if(!panel.isConnected){cleanup();return;}
      if(panel.hidden===Boolean(revealWhen()))panel.hidden=!revealWhen();
      if(ticket && (!live() || identity()!==ticket))clear('Đã dừng phần giải thích cũ. Bấm lại cho mục đang học.');
    }};
    function cleanup(){if(disposed)return;clear();conversation.cleanup();disposed=true;active.delete(entry);panel.remove();}
    compare.onclick=()=>{
      if(!translated || !live())return;
      if(showingGenerated){restore();status.textContent='Đang xem nội dung gốc.';}
      else{
        for(const target of bindings)target.element.textContent=translated.get(target.key);
        showingGenerated=true;compare.textContent='Xem bản gốc';onApply(translated);
        generated.hidden=!generated.children.length;
        status.textContent='Đang xem bản diễn giải AI, chưa được thẩm định độc lập.';
      }
    };
    button.onclick=async()=>{
      if(controller || !live())return;
      if(translated){conversation.open();return;}
      const owner=identity();
      if(owner===null){status.textContent='Không đọc được tài khoản chat. Mở Cài đặt để chọn lại.';return;}
      clear();ticket=owner;
      const request=new AbortController();controller=request;
      button.disabled=true;button.setAttribute('aria-busy','true');status.textContent='Thầy đang xem bài của em…';
      const current=()=>controller===request && !request.signal.aborted && live() && identity()===owner;
      try {
        let reference=null;
        if(focus?.kind==='question'){
          if(!attempt)throw new Error('Chưa xác định đúng phiên bản câu hỏi. Mở lại bài.');
          await recordTaskEvent(attempt,'assist',{help:'translation'});
          reference=await taskReference(attempt.task);
        }
        if(!current())return;
        const response=await apiFetch('/api/practice/coach',{method:'POST',signal:AbortSignal.any([request.signal,AbortSignal.timeout(35000)]),
          headers:{'Content-Type':'application/json'},body:JSON.stringify({lesson,focus,view,action:'teach',...(reference?{task:reference}:{})})});
        const data=await response.json();
        if(!current())return;
        if(!response.ok)throw new Error(data.detail || 'AI chưa soạn được phần học. Nội dung gốc được giữ nguyên.');
        if(data.action!=='teach' || !same(data.lesson,lesson) || !same(data.focus,focus) || data.view!==view
          || typeof data.reply!=='string' || !data.reply.trim() || data.reply.length>2000 || !Array.isArray(data.fields) || data.fields.length>64)throw new Error('Phần AI không khớp mục đang học. Nội dung gốc được giữ nguyên.');
        if(reference && (data.task?.id!==reference.id || data.task?.revision!==reference.revision))throw new Error('Bài đã đổi phiên bản. Mở lại trước khi dùng AI.');
        const fields=new Map();
        for(const field of data.fields){
          if(!field || typeof field.key!=='string' || typeof field.source!=='string' || typeof field.text!=='string'
            || !field.text.trim() || field.text.length>8000 || fields.has(field.key))throw new Error('Bản diễn giải AI không đầy đủ. Hãy thử lại nếu muốn.');
          fields.set(field.key,field);
        }
        for(const target of bindings){
          const field=fields.get(target.key);
          if(!field || field.source!==target.source || target.element.textContent!==target.source)throw new Error('Bài gốc đã thay đổi. Mở lại đúng mục trước khi dùng AI.');
        }
        translated=new Map([...fields].map(([key,field])=>[key,field.text]));
        for(const target of bindings)target.element.textContent=translated.get(target.key);
        generated.replaceChildren();
        const bound=new Set(bindings.map(target=>target.key));
        for(const field of fields.values())if(!bound.has(field.key) && field.text!==field.source){
          const original=document.createElement('p');original.lang='ja';original.textContent=field.source;
          const translation=document.createElement('p');translation.textContent=field.text;
          const label=document.createElement('strong');label.textContent='Diễn giải AI từ nguyên văn · chưa thẩm định';
          generated.append(label,original,translation);
        }
        generated.hidden=!generated.children.length;
        showingGenerated=true;compare.hidden=false;compare.textContent='Xem bản gốc';
        onApply(translated);
        output.textContent=data.reply;output.hidden=false;status.textContent='Diễn giải AI để tham khảo; không thay đổi đáp án hoặc điểm.';
        button.textContent='Em vẫn chưa hiểu';
      } catch(error) {
        if(current()){status.textContent=error.name==='TimeoutError'?'Kết nối hơi lâu. Em nhờ thầy thử lại nhé.':error.message || 'Chưa nhận được phần giảng bài.';button.textContent='Nhờ thầy thử lại';}
      } finally {
        if(controller===request){
          controller=null;button.disabled=false;button.setAttribute('aria-busy','false');
          if(!live() || identity()!==owner)clear('Đã bỏ phản hồi của mục hoặc tài khoản cũ.');
        }
      }
    };
    active.add(entry);
    panel.hidden=!revealWhen();
    return cleanup;
  };
  globalThis.mountLessonTeaching = (body,item,level,skill) => {
    const descriptor=currentLesson,lesson=buildLessonContext(item,level,skill);
    const reference=body.querySelector('#lesson-reference');
    const target=(key,selector,source)=>studyTarget(key,reference.querySelector(selector),source);
    const targets=[
      target('meaning','.lesson-meaning',item.meaning_vi),
      target('formula','.lesson-formula code',item.formula),
      target('explanation','.lesson-explain',item.explanation || item.summary),
      target('translation','.reading-translation',item.translation),
      target('script_vi','.listening-translation',item.script_vi),
      ...(item.examples || []).map((example,index)=>target(`example:${index}:vi`,`[data-teacher-example="${index}"] .example-vi`,example.vi))
    ];
    mountStudyTeacher(reference,{lesson,targets,isCurrent:()=>currentLesson===descriptor && body.dataset.mode==='read'});
    reference.querySelectorAll('.word-detail').forEach((element,index)=>{
      const word=item.items[index],host=element.querySelector('.word-detail-body');
      mountStudyTeacher(host,{lesson,focus:{kind:'word',index},isCurrent:()=>currentLesson===descriptor && element.open && body.dataset.mode==='read',
        targets:[studyTarget('word:vi',host.querySelector('.word-answer p:last-child'),word.vi),
          ...(word.examples || []).map((example,i)=>studyTarget(`word:example:${i}:vi`,host.querySelectorAll('.example-vi')[i],example.vi))]});
    });
  };
  let releaseFlashcard=()=>{},releaseKaiwa=()=>{},releaseQuiz=()=>{};
  globalThis.clearStudySurface = kind => {
    if(kind==='flashcards'){releaseFlashcard();releaseFlashcard=()=>{};}
    if(kind==='kaiwa'){releaseKaiwa();releaseKaiwa=()=>{};}
    if(kind==='quiz'){releaseQuiz();releaseQuiz=()=>{};}
  };
  globalThis.mountFlashcardTeaching = item => {
    releaseFlashcard();
    const context=globalThis.teacherContext?.(),card=document.getElementById('flashcard-card');
    if(!context?.lesson || context.focus?.kind!=='word')return;
    const host=document.createElement('div');host.className='flashcard-teaching';card.closest('.flashcard-stage').append(host);
    const cleanup=mountStudyTeacher(host,{lesson:context.lesson,focus:context.focus,
      isCurrent:()=>fcDeck[fcIdx]===item,revealWhen:()=>card.classList.contains('flipped'),
      targets:[studyTarget('word:vi',document.getElementById('fc-back-meaning'),item.back),
        studyTarget('word:example:0:vi',document.getElementById('fc-example-vi'),item.exampleVi)]});
    releaseFlashcard=()=>{cleanup();host.remove();};
  };
  globalThis.mountKaiwaTeaching = (scenario,prompt) => {
    releaseKaiwa();
    const descriptor=findFeatureLesson('kaiwa',activeKaiwaLevel,`kaiwa-lesson:${activeKaiwaLevel}:${activeKaiwaKey}`);
    const index=descriptor?.examples?.findIndex(example=>example.jp===prompt.jp && example.vi===prompt.vi);
    if(index===undefined || index<0)return;
    const key=activeKaiwaKey,position=activeKaiwaPromptIdx,host=document.createElement('div');
    document.querySelector('.kaiwa-prompt-card').append(host);
    const cleanup=mountStudyTeacher(host,{lesson:buildLessonContext(descriptor,activeKaiwaLevel,'listening'),focus:{kind:'example',index},
      targets:[studyTarget('example:vi',document.getElementById('kaiwa-prompt-vi'),prompt.vi)],
      isCurrent:()=>activeKaiwaKey===key && activeKaiwaPromptIdx===position});
    releaseKaiwa=()=>{cleanup();host.remove();};
  };
  globalThis.mountQuizTeaching = () => {
    releaseQuiz();
    const index=examQuestionIdx,question=currentExamQuestions[index];
    const descriptor=featureLessons('quiz',activeQuizLevel).find(item=>item.examIndex===activeQuizTestIdx);
    if(!question || !descriptor)return;
    const host=document.createElement('div');document.getElementById('quiz-card').append(host);
    const buttons=[...document.querySelectorAll('#quiz-options-grid .quiz-option-label')];
    const task=lessonQuestions(descriptor,activeQuizLevel,'reading')[index];
    if(!task || task.unavailable_reason){host.remove();return;}
    const cleanup=mountStudyTeacher(host,{lesson:buildLessonContext(descriptor,activeQuizLevel,'reading'),focus:{kind:'question',index},view:'exam',task,
      targets:buttons.map((element,i)=>studyTarget(`question:option:${i}`,element,task.opts[i])),
      isCurrent:()=>examQuestionIdx===index && currentExamQuestions[index]===question && !document.getElementById('quiz-card').hidden});
    releaseQuiz=()=>{cleanup();host.remove();};
  };
})();
