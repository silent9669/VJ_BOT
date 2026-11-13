// Review retains original task positions; source-key agreement is not verified mastery.
function createPracticeRound(questions,indices=questions.map((_,index)=>index)){
  return {indices,index:0,correct:0,missed:[],blocked:0,checked:false,
    answer(value){
      const originalIndex=this.indices[this.index],task=questions[originalIndex];
      if(this.checked || !task || task.unavailable_reason)return null;
      if(task.mode==='choice' && (!Number.isInteger(value) || value<0 || value>=task.opts.length))return null;
      if(task.mode==='recall' && (typeof value!=='string' || !value.trim()))return null;
      this.checked=true;
      const correct=task.mode==='choice'?value===task.answer_index:
        (task.accepted_answers || []).some(answer=>answer.normalize('NFC').trim()===value.normalize('NFC').trim());
      if(correct)this.correct++;else this.missed.push(originalIndex);
      return {correct,originalIndex,selected:value};
    },
    next(){if(!this.checked)return false;this.index++;this.checked=false;return true;}
  };
}

let practiceCoachRequest = null, practiceCoachRefresh = null;
function cancelPracticeCoach() {
  practiceCoachRequest?.abort();
  practiceCoachRequest = null;
}
function practiceCoachIdentity() {
  try {
    const owner = typeof signedInUser === 'undefined' ? null : signedInUser?.user_id;
    if (typeof signedInUser !== 'undefined' && signedInUser?.is_admin === true) return JSON.stringify([owner,location.hash,'platform']);
    return JSON.stringify([owner, location.hash, window.usesAntigravityOAuth?.(owner),
      window.antigravityConnectionId?.(owner), owner && window.VJProfiles?.active(owner)]);
  } catch { return null; }
}
function mountPracticeCoach(section, container, lesson, question, index, result) {
  const area=document.createElement('aside');area.className='practice-coach';area.setAttribute('aria-label','Học cùng thầy Lâm');area.setAttribute('data-teacher-exclude','');
  const heading=document.createElement('strong');heading.textContent='Cùng thầy Lâm gỡ từng bước';
  const button=document.createElement('button');button.type='button';
  button.textContent=result ? result.correct?'Thầy giải thích giúp em nhé':'Thầy giúp em sửa nhé' : 'Thầy gợi ý cho em nhé';
  const output=document.createElement('p');output.className='practice-coach-reply';output.setAttribute('role','status');output.hidden=true;
  const ask=document.createElement('button');ask.type='button';ask.textContent='Em vẫn chưa hiểu';ask.hidden=true;
  area.append(heading,button,output,ask);section.querySelector('.practice-actions').before(area);
  let owner=practiceCoachIdentity();
  const conversation=globalThis.mountTeacherConversation?.(area,{trigger:ask,lesson,focus:{kind:'question',index},task:question,
    isCurrent:()=>area.isConnected && !container.hidden && practiceCoachIdentity()===owner});
  ask.onclick=()=>conversation?.open();
  const refresh=()=>{
    if(!area.isConnected){if(practiceCoachRefresh===refresh)practiceCoachRefresh=null;return;}
    const identity=practiceCoachIdentity();
    if(identity===owner)return;
    owner=identity;cancelPracticeCoach();conversation?.clear();
    output.textContent='';output.hidden=true;ask.hidden=true;
    button.disabled=false;button.setAttribute('aria-busy','false');
  };
  practiceCoachRefresh=refresh;
  button.onclick=async()=>{
    if(button.disabled)return;
    const identity=practiceCoachIdentity(), action=result?'feedback':'hint';
    if(identity===null){output.hidden=false;output.textContent='Không đọc được cài đặt AI. Mở Cài đặt để chọn lại tài khoản.';return;}
    cancelPracticeCoach();
    const controller=new AbortController();practiceCoachRequest=controller;
    controller.signal.addEventListener('abort',()=>{button.disabled=false;button.setAttribute('aria-busy','false');output.textContent='Đã dừng phản hồi AI. Bấm lại nếu muốn hỏi câu này.';},{once:true});
    const current=()=>practiceCoachRequest===controller&&!controller.signal.aborted
      &&area.isConnected&&!container.hidden&&practiceCoachIdentity()===identity;
    button.disabled=true;button.setAttribute('aria-busy','true');output.hidden=false;output.textContent='Thầy đang xem câu này cùng em…';
    try{
      await recordTaskEvent(taskAttempt(lesson,question,index),'assist',{help:result?'chat':'hint'});
      const task=await taskReference(question);
      if(!current())return;
      const response=await apiFetch('/api/practice/coach',{method:'POST',
        headers:{'Content-Type':'application/json'},signal:AbortSignal.any([controller.signal,AbortSignal.timeout(45000)]),
        body:JSON.stringify({lesson,question_index:index,item_id:question.item_id,task,action,
          ...(result?question.mode==='choice'?{answer_index:result.selected}:{response_text:result.selected}:{})})});
      const data=await response.json();if(!current())return;
      if(!response.ok)throw new Error(data.detail||'AI chưa giải thích được. Bạn vẫn có thể tiếp tục làm bài.');
      if(data.item_id!==question.item_id || data.action!==action || typeof data.reply!=='string' || !data.reply.trim()
        || data.task?.id!==task.id || data.task?.revision!==task.revision
        || (result && (data.answer_index!==question.answer_index || data.correct!==result.correct)))throw new Error('Câu hỏi hoặc đáp án đã thay đổi. Mở lại bài để hỏi AI.');
      output.textContent=data.reply;ask.hidden=!conversation;
    }catch(error){
      if(current())output.textContent=error.name==='TimeoutError'?'AI phản hồi quá lâu. Bấm lại nếu muốn thử; kết quả bài làm được giữ nguyên.':error.message||'AI tạm thời chưa trả lời.';
    }finally{
      if(practiceCoachRequest===controller){practiceCoachRequest=null;button.disabled=false;button.setAttribute('aria-busy','false');}
    }
  };
  return ()=>{cancelPracticeCoach();if(practiceCoachRefresh===refresh)practiceCoachRefresh=null;conversation?.cleanup();area.remove();};
}
for(const event of ['hashchange','popstate','pagehide','vjbot-account-ready'])globalThis.addEventListener?.(event,()=>{cancelPracticeCoach();practiceCoachRefresh?.();});
globalThis.addEventListener?.('vjbot-voice-changed',()=>practiceCoachRefresh?.());
globalThis.addEventListener?.('storage',event=>{
  if(event.key===null||/^vjbot_ai_(?:active_v1|method|oauth):/.test(event.key)){cancelPracticeCoach();practiceCoachRefresh?.();}
});

function renderPracticeSession(container,item,level,skill){
  const questions=lessonQuestions(item,level,skill),lesson=buildLessonContext(item,level,skill);
  const scopedReview=Number.isInteger(item.reviewQuestionIndex) && item.reviewQuestionIndex>=0 && item.reviewQuestionIndex<questions.length;
  let round=createPracticeRound(questions,scopedReview?[item.reviewQuestionIndex]:undefined),review=scopedReview;
  const section=document.createElement('section');section.className='practice-session';container.append(section);
  const completion=document.getElementById('lesson-completion');
  function show(focus=false){
    cancelPracticeCoach();section.replaceChildren();
    if(round.index===round.indices.length){
      delete section.dataset.teacherQuestion;globalThis.setTeacherFocus?.(null);
      section.innerHTML=`<div class="practice-result"><h3 tabindex="-1">${review?'Đã ôn xong':'Đối chiếu bài luyện'}</h3>
        <p class="practice-score">${round.correct}<span> / ${round.indices.length-round.blocked} câu khớp đáp án nguồn${review?' khi ôn':''}</span></p>
        <p>Đáp án nguồn chưa được thẩm định độc lập; đây không phải điểm xác minh hoặc bằng chứng đã thành thạo.</p>
        ${round.blocked?`<p>${round.blocked} câu chưa khả dụng, vẫn giữ trong phạm vi bộ bài; chưa thể xác nhận đã làm trọn bộ.</p>`:''}
        <div class="practice-result-actions"></div></div>`;
      const actions=section.querySelector('.practice-result-actions');
      if(round.missed.length){
        const retry=document.createElement('button');retry.type='button';retry.textContent=`Ôn ${round.missed.length} câu chưa khớp`;
        retry.onclick=()=>{round=createPracticeRound(questions,round.missed);review=true;show(true);};actions.append(retry);
      }
      const restart=document.createElement('button');restart.type='button';restart.textContent='Làm lại từ đầu';
      restart.onclick=()=>{round=createPracticeRound(questions);review=false;show(true);};actions.append(restart);
      completion.hidden=round.blocked>0 || scopedReview;
      if(focus)section.querySelector('h3').focus();
      return;
    }
    completion.hidden=true;
    const originalIndex=round.indices[round.index],question=questions[originalIndex];
    section.dataset.teacherQuestion=String(originalIndex);
    const attempt=taskAttempt(lesson,question,originalIndex,'checks',true);
    if(!container.hidden)globalThis.setTeacherFocus?.({kind:'question',index:originalIndex});
    section.innerHTML=`<div class="practice-meter"><span>${review?'Ôn lại':'Luyện tập'}</span><span>${round.index+1} / ${round.indices.length}</span>
      <progress value="${round.index}" max="${round.indices.length}" aria-label="Câu đã xem"></progress></div>
      <fieldset><legend tabindex="-1">${escapeHtml(question.instruction || (question.mode==='recall'?'Tự nhớ và nhập câu trả lời':'Chọn một phương án'))}</legend>
      ${taskPromptHtml({...question,instruction:''})}<div class="practice-options"></div></fieldset>
      <p class="task-basis">Luyện tham khảo theo nguồn, chưa phải bài chấm điểm được thẩm định.</p>
      <div class="practice-feedback" role="status" hidden></div><div class="practice-actions"><button type="button" class="practice-primary" disabled>Đối chiếu</button></div>`;
    const options=section.querySelector('.practice-options'),action=section.querySelector('.practice-primary'),feedback=section.querySelector('.practice-feedback');
    if(question.unavailable_reason){
      feedback.hidden=false;feedback.textContent=`Câu này tạm ngừng sử dụng: ${taskUnavailableMessage(question)}`;
      action.disabled=false;action.textContent='Qua câu chưa khả dụng';
      action.onclick=()=>{round.blocked++;round.checked=true;round.next();show(true);};
      if(focus)section.querySelector('legend').focus();
      return;
    }
    if(question.script_jp){
      const listen=document.createElement('button');listen.type='button';listen.className='task-listen';listen.textContent='Nghe ngữ cảnh câu hỏi';
      listen.onclick=()=>playGeminiTTS(question.script_jp,{language:'ja-JP',lesson,focus:{kind:'question',index:originalIndex},task:question});
      section.querySelector('fieldset').prepend(listen);
    }
    let selected=null,pending=null;
    const optionTexts=[];
    const feedbackMessage=()=>{
      const answer=question.mode==='choice'?optionTexts[question.answer_index]?.textContent || question.opts[question.answer_index]:(question.accepted_answers || []).join(' / ');
      return `${pending?.correct?'Câu trả lời khớp đáp án nguồn.':'Câu trả lời chưa khớp đáp án nguồn.'} ${answer?`Đáp án nguồn: ${answer}.`:''} ${question.explanation || 'Nguồn chưa có lời giải đầy đủ; không suy ra rằng cách trả lời khác luôn sai.'}`;
    };
    let removeCoach=mountPracticeCoach(section,container,lesson,question,originalIndex,null);
    if(question.mode==='choice'){
      for(const [index,option] of question.opts.entries()){
        const label=document.createElement('label');label.className='practice-option';
        const input=document.createElement('input');input.type='radio';input.name='practice-answer';input.value=String(index);
        const number=document.createElement('span');number.className='practice-option-number';number.textContent=String(index+1);
        const text=document.createElement('span');text.textContent=option;optionTexts.push(text);
        const select=()=>globalThis.setTeacherFocus?.({kind:'question',index:originalIndex});input.addEventListener('focus',select);
        input.onchange=()=>{select();selected=index;action.disabled=false;};label.append(input,number,text);options.append(label);
      }
    }else if(question.mode==='recall'){
      const label=document.createElement('label');label.textContent='Câu trả lời của em';
      const input=document.createElement('input');input.type='text';input.maxLength=4000;input.lang='ja';input.autocomplete='off';
      input.oninput=()=>{selected=input.value.trim();action.disabled=!selected;};
      input.addEventListener('focus',()=>globalThis.setTeacherFocus?.({kind:'question',index:originalIndex}));
      label.append(input);options.append(label);
    }else{
      feedback.hidden=false;feedback.textContent='Dạng bài này cần mở hoạt động viết/nghe tương ứng, không được chấm như trắc nghiệm.';
      action.disabled=false;action.textContent='Qua câu chưa hỗ trợ';action.onclick=()=>{round.blocked++;round.checked=true;round.next();show(true);};return;
    }
    globalThis.mountStudyTeacher?.(section,{lesson,focus:{kind:'question',index:originalIndex},task:question,
      targets:optionTexts.map((element,index)=>globalThis.studyTarget(`question:option:${index}`,element,question.opts[index])),
      isCurrent:()=>!container.hidden && round.indices[round.index]===originalIndex,
      onApply:()=>{if(pending){pending.feedback=feedbackMessage();feedback.textContent=pending.feedback;}}});
    async function save(){
      action.disabled=true;action.textContent='Đang lưu…';
      try{
        await recordTaskEvent(attempt,'answer',question.mode==='choice'?{answer_index:selected}:{response_text:selected});
        if(!section.isConnected)return;
        if(!pending.coachReady){
          removeCoach();removeCoach=mountPracticeCoach(section,container,lesson,question,originalIndex,pending);pending.coachReady=true;
        }
        feedback.textContent=pending.feedback;action.textContent=round.index+1===round.indices.length?'Xem đối chiếu':'Tiếp tục';action.disabled=false;
        action.onclick=()=>{round.next();show(true);};action.focus();
      }catch(error){
        if(!section.isConnected)return;
        feedback.textContent=pending.feedback+' '+error.message;action.textContent='Lưu lại';action.disabled=false;action.onclick=save;action.focus();
      }
    }
    action.onclick=async()=>{
      const answer=round.answer(selected);if(!answer)return;
      pending={...answer,feedback:''};pending.feedback=feedbackMessage();
      removeCoach();
      options.querySelectorAll('input').forEach((input,index)=>{
        input.disabled=true;
        if(question.mode==='choice')input.closest('label').dataset.state=index===question.answer_index?'correct':index===selected?'incorrect':'idle';
      });
      feedback.hidden=false;feedback.dataset.correct=String(answer.correct);feedback.textContent=pending.feedback;
      section.querySelector('progress').value=round.index+1;await save();
    };
    if(focus){section.querySelector('legend').focus();section.scrollIntoView({block:'nearest'});}
  }
  show();
}
