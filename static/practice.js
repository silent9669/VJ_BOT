// One response per question; review keeps original IDs and never inflates the first score.
function createPracticeRound(questions, indices=questions.map((_,i)=>i)) {
  return {indices,index:0,correct:0,missed:[],checked:false,
    answer(option){
      const originalIndex=this.indices[this.index],q=questions[originalIndex];
      if(this.checked || !q?.opts.includes(option))return null;
      this.checked=true;
      const correct=option===q.ans;
      if(correct)this.correct++;else this.missed.push(originalIndex);
      return {correct,originalIndex};
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
  const conversation=globalThis.mountTeacherConversation?.(area,{trigger:ask,lesson,focus:{kind:'question',index},
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
      const response=await apiFetch('/api/practice/coach',{method:'POST',
        headers:{'Content-Type':'application/json'},signal:AbortSignal.any([controller.signal,AbortSignal.timeout(45000)]),
        body:JSON.stringify({lesson,question_index:index,item_id:question.item_id,action,
          ...(result?{answer_index:question.opts.indexOf(result.selected)}:{})})});
      const data=await response.json();if(!current())return;
      if(!response.ok)throw new Error(data.detail||'AI chưa giải thích được. Bạn vẫn có thể tiếp tục làm bài.');
      if(data.item_id!==question.item_id||data.action!==action||typeof data.reply!=='string'||!data.reply.trim()
        ||(result&&(data.answer!==question.ans||data.correct!==result.correct)))throw new Error('Câu hỏi hoặc đáp án đã thay đổi. Mở lại bài để hỏi AI.');
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

function renderPracticeSession(container,item,level,skill,record){
  const questions=lessonQuestions(item,level,skill);
  let round=createPracticeRound(questions),review=false;
  const section=document.createElement('section');section.className='practice-session';container.append(section);
  const completion=document.getElementById('lesson-completion');
  function show(focus=false){
    cancelPracticeCoach();
    section.replaceChildren();
    if(round.index===round.indices.length){
      delete section.dataset.teacherQuestion;
      globalThis.setTeacherFocus?.(null);
      section.innerHTML=`<div class="practice-result"><img src="assets/lam/teacher.svg" alt="Thầy Lâm" width="76" height="96"><h3 tabindex="-1">${review?'Đã ôn xong':'Kết quả luyện tập'}</h3><p class="practice-score">${round.correct}<span> / ${round.indices.length} câu đúng${review?' khi ôn':' lần đầu'}</span></p><div class="practice-result-actions"></div></div>`;
      const actions=section.querySelector('.practice-result-actions');
      if(round.missed.length){
        const retry=document.createElement('button');retry.className='practice-primary';retry.textContent=`Ôn ${round.missed.length} câu sai`;
        retry.onclick=()=>{round=createPracticeRound(questions,round.missed);review=true;show(true);};actions.append(retry);
      }
      const restart=document.createElement('button');restart.textContent='Làm lại từ đầu';restart.onclick=()=>{round=createPracticeRound(questions);review=false;show(true);};actions.append(restart);
      completion.hidden=false;
      if(focus)section.querySelector('h3').focus();
      return;
    }
    completion.hidden=true;
    const originalIndex=round.indices[round.index],q=questions[originalIndex];
    section.dataset.teacherQuestion=String(originalIndex);
    if(!container.hidden)globalThis.setTeacherFocus?.({kind:'question',index:originalIndex});
    section.innerHTML=`<div class="practice-meter"><span>${review?'Ôn câu sai':'Luyện tập'}</span><span>${round.index+1} / ${round.indices.length}</span><progress value="${round.index}" max="${round.indices.length}" aria-label="Câu đã làm"></progress></div><fieldset><legend tabindex="-1">${escapeHtml(q.q)}</legend><div class="practice-options"></div></fieldset><div class="practice-feedback" role="status" hidden></div><div class="practice-actions"><button type="button" class="practice-primary" disabled>Kiểm tra</button></div>`;
    const options=section.querySelector('.practice-options'),action=section.querySelector('.practice-primary'),feedback=section.querySelector('.practice-feedback');
    let selected=null,pending=null;
    const optionTexts=[];
    const feedbackMessage=()=>`${pending?.correct?'Chính xác.':`Đáp án: ${optionTexts[q.opts.indexOf(q.ans)]?.textContent || q.ans}.`}`;
    let removeCoach=mountPracticeCoach(section,container,buildLessonContext(item,level,skill),q,originalIndex,null);
    for(const [i,option] of q.opts.entries()){
      const label=document.createElement('label');label.className='practice-option';
      const input=document.createElement('input');input.type='radio';input.name='practice-answer';input.value=String(i);
      const number=document.createElement('span');number.className='practice-option-number';number.textContent=String(i+1);
      const text=document.createElement('span');text.textContent=option;
      optionTexts.push(text);
      const selectFocus=()=>globalThis.setTeacherFocus?.({kind:'question',index:originalIndex});
      input.addEventListener('focus',selectFocus);
      input.onchange=()=>{selectFocus();selected=option;action.disabled=false;};label.append(input,number,text);options.append(label);
    }
    globalThis.mountStudyTeacher?.(section,{lesson:buildLessonContext(item,level,skill),focus:{kind:'question',index:originalIndex},
      targets:[globalThis.studyTarget('question:q',section.querySelector('legend'),q.q),
        ...optionTexts.map((element,index)=>globalThis.studyTarget(`question:option:${index}`,element,q.opts[index]))],
      isCurrent:()=>!container.hidden && round.indices[round.index]===originalIndex,
      onApply:()=>{if(pending){pending={...pending,feedback:feedbackMessage()};feedback.textContent=pending.feedback;}}});
    async function save(){
      action.disabled=true;action.textContent='Đang lưu…';
      try{
        await record(q.item_id,pending.correct,q.q,pending.id,selected);
        if(!section.isConnected)return;
        feedback.textContent=pending.feedback;
        action.textContent=round.index+1===round.indices.length?'Xem kết quả':'Tiếp tục';action.disabled=false;
        action.onclick=()=>{round.next();show(true);};action.focus();
      }catch{
        if(!section.isConnected)return;
        feedback.textContent=pending.feedback+' Chưa lưu được tiến độ. Thử lưu lại.';
        action.textContent='Lưu lại';action.disabled=false;action.onclick=save;action.focus();
      }
    }
    action.onclick=async()=>{
      const answer=round.answer(selected);if(!answer)return;
      removeCoach();
      removeCoach=mountPracticeCoach(section,container,buildLessonContext(item,level,skill),q,originalIndex,{correct:answer.correct,selected});
      pending={...answer,id:crypto.randomUUID()};
      const message=feedbackMessage();
      pending={...pending,feedback:message};
      if(q.explanation){
        const source=document.createElement('details'),summary=document.createElement('summary'),text=document.createElement('p');
        summary.textContent='Giải thích từ nguồn gốc';text.textContent=q.explanation;source.append(summary,text);section.append(source);
      }
      options.querySelectorAll('input').forEach((input,i)=>{input.disabled=true;input.closest('label').dataset.state=q.opts[i]===q.ans?'correct':q.opts[i]===selected?'incorrect':'idle';});
      feedback.hidden=false;feedback.dataset.correct=String(answer.correct);feedback.textContent=message;
      section.querySelector('progress').value=round.index+1;
      await save();
    };
    if(focus){section.querySelector('legend').focus();section.scrollIntoView({block:'nearest'});}
  }
  show();
}
