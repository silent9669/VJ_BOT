// Review retains original task positions; source-key agreement is not verified mastery.
function createPracticeRound(questions,indices=questions.map((_,index)=>index)){
  return {indices,index:0,correct:0,missed:[],blocked:0,unassessed:0,checked:false,
    answer(value){
      const originalIndex=this.indices[this.index],task=questions[originalIndex];
      if(this.checked || !task || task.unavailable_reason)return null;
      if(task.mode==='choice' && (!Number.isInteger(value) || value<0 || value>=task.opts.length))return null;
      if(['recall','writing'].includes(task.mode) && (typeof value!=='string' || !value.trim()))return null;
      this.checked=true;
      const correct=task.mode==='writing'?null:task.mode==='choice'?value===task.answer_index:
        (task.accepted_answers || []).some(answer=>answer.normalize('NFC').trim()===value.normalize('NFC').trim());
      if(correct===null)this.unassessed++;else if(correct)this.correct++;else this.missed.push(originalIndex);
      return {correct,originalIndex,selected:value};
    },
    next(){if(!this.checked)return false;this.index++;this.checked=false;return true;}
  };
}

let practiceCoachRequest = null, practiceCoachRefresh = null, practiceRunRefresh = null;
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
  button.textContent=result ? result.correct===null?'Thầy nhận xét câu em viết':result.correct?'Thầy giải thích giúp em nhé':'Thầy giúp em sửa nhé' : 'Thầy gợi ý cho em nhé';
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
      const attempt=taskAttempt(lesson,question,index);
      await recordTaskEvent(attempt,'assist',{help:result?'chat':'hint'});
      const task=await taskReference(question);
      if(!current())return;
      const response=await apiFetch('/api/practice/coach',{method:'POST',
        headers:{'Content-Type':'application/json'},signal:AbortSignal.any([controller.signal,AbortSignal.timeout(45000)]),
        body:JSON.stringify({lesson,question_index:index,item_id:question.item_id,task,action,attempt_id:attempt.id,
          ...(attempt.sessionId?{session_id:attempt.sessionId}:{}),
          ...(result?question.mode==='choice'?{answer_index:result.selected}:{response_text:result.selected}:{})})});
      const data=await response.json();if(!current())return;
      if(!response.ok)throw new Error(data.detail||'AI chưa giải thích được. Em vẫn có thể tiếp tục làm bài.');
      const resultMatches=!result || (question.mode==='writing'
        ?data.source_correct===null && data.assessment?.comparison==='unassessed'
        :data.answer_index===question.answer_index && data.correct===result.correct);
      if(data.item_id!==question.item_id || data.action!==action || typeof data.reply!=='string' || !data.reply.trim()
        || data.task?.id!==task.id || data.task?.revision!==task.revision || !resultMatches)throw new Error('Câu hỏi hoặc đáp án đã thay đổi. Mở lại bài để hỏi AI.');
      output.textContent=data.reply;ask.hidden=!conversation;
    }catch(error){
      if(current())output.textContent=error.name==='TimeoutError'?'AI phản hồi quá lâu. Bấm lại nếu muốn thử; kết quả bài làm được giữ nguyên.':error.message||'AI tạm thời chưa trả lời.';
    }finally{
      if(practiceCoachRequest===controller){practiceCoachRequest=null;button.disabled=false;button.setAttribute('aria-busy','false');}
    }
  };
  return ()=>{cancelPracticeCoach();if(practiceCoachRefresh===refresh)practiceCoachRefresh=null;conversation?.cleanup();area.remove();};
}
for(const event of ['hashchange','popstate','pagehide','vjbot-account-ready'])globalThis.addEventListener?.(event,()=>{cancelPracticeCoach();practiceCoachRefresh?.();practiceRunRefresh?.();});
globalThis.addEventListener?.('vjbot-voice-changed',()=>practiceCoachRefresh?.());
globalThis.addEventListener?.('storage',event=>{
  if(event.key===null||/^vjbot_ai_(?:active_v1|method|oauth):/.test(event.key)){cancelPracticeCoach();practiceCoachRefresh?.();}
});

function taskAssessmentMessage(task,assessment,matched){
  if(task.mode==='writing')return 'Em xem lại câu vừa viết theo các mục tự kiểm tra nhé.';
  if(assessment?.comparison==='orthographic_difference')return 'Câu em viết khác mẫu ở cách trình bày, như dấu chấm hoặc khoảng trắng; chưa thể kết luận sai nghĩa hay ngữ pháp.';
  if(task.mode==='choice')return matched?'Em chọn đúng đáp án.':'Em chưa chọn đúng đáp án.';
  return `${matched?'Câu em viết khớp mẫu.':'Câu em viết chưa khớp mẫu.'} Cách viết khác vẫn có thể đúng.`;
}
function practiceTaskIndices(item,questions,{reference=false}={}){
  if(Number.isInteger(item.reviewQuestionIndex) && item.reviewQuestionIndex>=0 && item.reviewQuestionIndex<questions.length)return [item.reviewQuestionIndex];
  const ids=reference?item.reference_task_ids:item.practice_path || item.guided_steps?.flatMap(step=>step.task_ids);
  if(ids?.length)return ids.map(id=>questions.findIndex(task=>task.task_id===id)).filter(index=>index>=0);
  return questions.map((_,index)=>index).filter(index=>questions[index].exchange?.stage!=='delayed');
}
function renderPracticeSession(container,item,level,skill){
  const questions=lessonQuestions(item,level,skill),lesson=buildLessonContext(item,level,skill);
  const scopedReview=Number.isInteger(item.reviewQuestionIndex) && item.reviewQuestionIndex>=0 && item.reviewQuestionIndex<questions.length;
  const initialIndices=practiceTaskIndices(item,questions),sessionId=crypto.randomUUID(),savedResponses=new Map();
  const runAccount=typeof signedInUser==='undefined'?null:signedInUser?.user_id;
  const currentRun=()=>runAccount===(typeof signedInUser==='undefined'?null:signedInUser?.user_id);
  let round=createPracticeRound(questions,initialIndices),review=scopedReview;
  const section=document.createElement('section');section.className='practice-session';container.append(section);
  const completion=document.getElementById('lesson-completion');
  const invalidateRun=()=>{
    if(!section.isConnected || currentRun())return false;
    cancelPracticeCoach();savedResponses.clear();section.replaceChildren();
    const message=document.createElement('p');message.setAttribute('role','status');message.textContent='Tài khoản đã thay đổi. Mở lại bài để bắt đầu phiên riêng; câu viết của tài khoản cũ đã ẩn.';
    section.append(message);completion.hidden=true;
    return true;
  };
  practiceRunRefresh=invalidateRun;
  function show(focus=false){
    if(!currentRun()){invalidateRun();return;}
    cancelPracticeCoach();section.replaceChildren();
    if(round.index===round.indices.length){
      delete section.dataset.teacherQuestion;globalThis.setTeacherFocus?.(null);
      section.innerHTML=`<div class="practice-result"><h3 tabindex="-1">${review?'Kết quả lượt ôn':'Kết quả lượt luyện'}</h3>
        ${round.indices.length-round.blocked-round.unassessed>0?`<p class="practice-score">${round.correct}<span> / ${round.indices.length-round.blocked-round.unassessed} câu đúng đáp án hoặc khớp mẫu${review?' khi ôn':''}</span></p>`:''}
        <p>${round.indices.length-round.blocked-round.unassessed>0?'Các câu được kiểm tra bằng đáp án hoặc mẫu có sẵn. ':''}${round.unassessed?`${round.unassessed} câu tự viết đã lưu, chưa chấm đúng/sai. `:''}Lượt luyện này chưa xác nhận mức thành thạo. Nhận xét AI chỉ để tham khảo.</p>
        ${round.blocked?`<p>${round.blocked} câu đang tạm ngừng, chưa tính vào kết quả.</p>`:''}
        <div class="practice-result-actions"></div></div>`;
      const actions=section.querySelector('.practice-result-actions');
      if(round.missed.length){
        const retry=document.createElement('button');retry.type='button';retry.textContent=`Ôn ${round.missed.length} câu chưa khớp`;
        retry.onclick=()=>{round=createPracticeRound(questions,round.missed);review=true;show(true);};actions.append(retry);
      }
      const restart=document.createElement('button');restart.type='button';restart.textContent='Làm lại chuỗi này';
      restart.onclick=renderPracticeSessionAfterReset;actions.append(restart);
      if(item.reference_task_ids?.length && !scopedReview){
        const reference=document.createElement('button');reference.type='button';reference.textContent='Luyện nhớ theo mẫu';
        reference.onclick=()=>{round=createPracticeRound(questions,practiceTaskIndices(item,questions,{reference:true}));review=true;show(true);};actions.append(reference);
      }
      if(item.delayed_review_task_id){
        const note=document.createElement('p');note.textContent='Em có thể thử tình huống mới trong phiên khác, sau ít nhất 24 giờ kể từ khi hoàn tất các bước tự viết.';actions.append(note);
      }
      completion.hidden=round.blocked>0 || scopedReview;
      if(focus)section.querySelector('h3').focus();
      return;
    }
    completion.hidden=true;
    const originalIndex=round.indices[round.index],question=questions[originalIndex];
    section.dataset.teacherQuestion=String(originalIndex);
    const attempt=taskAttempt(lesson,question,originalIndex,'checks',true);attempt.sessionId=sessionId;
    if(!container.hidden)globalThis.setTeacherFocus?.({kind:'question',index:originalIndex});
    const stage=item.guided_steps?.find(step=>step.task_ids.includes(question.task_id));
    const previous=(question.exchange?.prior_task_ids || []).map(id=>savedResponses.get(id)).filter(value=>typeof value==='string');
    section.innerHTML=`<div class="practice-meter"><span>${review?'Luyện lại':'Luyện tập'}</span><span>${round.index+1} / ${round.indices.length}</span>
      <progress value="${round.index}" max="${round.indices.length}" aria-label="Câu đã xem"></progress></div>
      ${stage?`<aside class="task-stage"><h3>${escapeHtml(stage.title)}</h3><p>${escapeHtml(stage.note)}</p><p lang="ja">${escapeHtml(stage.example.jp)}</p><details><summary>Cách đọc và nghĩa của ví dụ</summary><p lang="ja">${escapeHtml(stage.example.reading)}</p><p>${escapeHtml(stage.example.vi)}</p></details></aside>`:''}
      ${previous.length?`<aside data-teacher-exclude><strong>${['accept','refuse'].includes(question.exchange.stage)?'Lời mời em vừa viết trong phiên này':'Câu em viết ở bước trước trong phiên này'}</strong>${previous.map(text=>`<p lang="ja">${escapeHtml(text)}</p>`).join('')}</aside>`:''}
      ${question.exchange?.partner_reply?`<p class="task-partner" lang="ja">${escapeHtml(question.exchange.partner_reply)}</p><p>Đây là lời đáp soạn sẵn để em luyện tiếp.</p>`:''}
      <fieldset><legend tabindex="-1">${escapeHtml(taskInstruction(question) || (question.mode==='writing'?'Tự chọn nội dung và viết câu':question.mode==='recall'?'Viết lại theo yêu cầu':'Chọn một đáp án'))}</legend>
      ${taskPromptHtml({...question,instruction:''})}<div class="practice-options"></div></fieldset>
      ${question.criteria?.length?`<section class="task-writing-criteria"${question.mode==='writing'?' hidden':''}><h4>Tự kiểm tra câu trả lời</h4><ul>${question.criteria.map(text=>`<li>${escapeHtml(text)}</li>`).join('')}</ul></section>`:''}
      <div class="practice-feedback" role="status" hidden></div><div class="practice-actions"><button type="button" class="practice-primary" disabled>${question.mode==='writing'?'Gửi bài':'Kiểm tra'}</button></div>`;
    const options=section.querySelector('.practice-options'),action=section.querySelector('.practice-primary'),feedback=section.querySelector('.practice-feedback');
    if(question.unavailable_reason){
      feedback.hidden=false;feedback.textContent=taskUnavailableMessage(question);
      action.disabled=false;action.textContent='Bỏ qua câu này';action.onclick=()=>{round.blocked++;round.checked=true;round.next();show(true);};
      if(focus)section.querySelector('legend').focus();return;
    }
    if(question.script_jp){
      const listen=document.createElement('button');listen.type='button';listen.className='task-listen';listen.textContent='Nghe ngữ cảnh câu hỏi';
      listen.onclick=()=>playGeminiTTS(question.script_jp,{language:'ja-JP',lesson,focus:{kind:'question',index:originalIndex},task:question});
      section.querySelector('fieldset').prepend(listen);
    }
    let selected=null,pending=null;
    const optionTexts=[];
    const renderFeedback=()=>{
      if(question.mode==='choice'){feedback.replaceChildren();feedback.hidden=true;return;}
      const result=document.createElement('p');result.textContent=taskAssessmentMessage(question,pending?.assessment,pending?.correct);
      feedback.replaceChildren(result);
      if(question.mode==='writing')return;
      const answers=question.accepted_answers || [];
      if(answers.length){
        const answer=document.createElement('p');answer.textContent=`Mẫu trả lời: ${answers.join(' hoặc ')}`;
        feedback.append(answer);
      }
      if(question.explanation){
        const details=document.createElement('details'),summary=document.createElement('summary'),reason=document.createElement('p');
        details.className='practice-reason';summary.textContent='Vì sao?';reason.textContent=question.explanation;
        details.append(summary,reason);feedback.append(details);
      }
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
    }else if(['recall','writing'].includes(question.mode)){
      const label=document.createElement('label');label.textContent='Câu trả lời của em';
      const input=document.createElement(question.mode==='writing'?'textarea':'input');
      if(question.mode==='recall')input.type='text';else input.rows=4;
      input.maxLength=4000;input.lang='ja';input.autocomplete='off';
      input.oninput=()=>{selected=input.value;action.disabled=!selected.trim();};
      input.addEventListener('focus',()=>globalThis.setTeacherFocus?.({kind:'question',index:originalIndex}));
      label.append(input);options.append(label);
    }else{
      feedback.hidden=false;feedback.textContent='Mở hoạt động nghe tương ứng để làm dạng bài này.';
      action.disabled=false;action.textContent='Bỏ qua câu này';action.onclick=()=>{round.blocked++;round.checked=true;round.next();show(true);};return;
    }
    globalThis.mountStudyTeacher?.(section,{lesson,focus:{kind:'question',index:originalIndex},task:question,
      targets:optionTexts.map((element,index)=>globalThis.studyTarget(`question:option:${index}`,element,question.opts[index])),
      isCurrent:()=>!container.hidden && round.indices[round.index]===originalIndex,
      onApply:()=>{if(pending?.saved)renderFeedback();}});
    async function save(){
      if(!currentRun()){invalidateRun();return;}
      action.disabled=true;action.textContent='Đang gửi…';
      try{
        const receipt=await recordTaskEvent(attempt,'answer',question.mode==='choice'?{answer_index:selected}:{response_text:selected});
        if(!section.isConnected)return;
        pending.assessment=receipt.assessment;pending.saved=true;
        savedResponses.set(question.task_id,selected);
        const criteria=section.querySelector('.task-writing-criteria');if(criteria)criteria.hidden=false;
        if(!pending.coachReady){
          removeCoach();removeCoach=mountPracticeCoach(section,container,lesson,question,originalIndex,pending);pending.coachReady=true;
        }
        renderFeedback();
        feedback.dataset.correct=receipt.assessment?.comparison==='orthographic_difference' || question.mode==='writing'?'unknown':String(pending.correct);
        action.textContent=round.index+1===round.indices.length?'Xem kết quả':'Tiếp tục';action.disabled=false;
        action.onclick=()=>{round.next();show(true);};action.focus();
      }catch(error){
        if(!section.isConnected)return;
        feedback.hidden=false;feedback.textContent='Chưa gửi được câu trả lời. '+error.message;action.textContent='Thử lại';action.disabled=false;action.onclick=save;action.focus();
      }
    }
    action.onclick=async()=>{
      if(!currentRun()){invalidateRun();return;}
      const answer=round.answer(selected);if(!answer)return;
      pending={...answer,saved:false};removeCoach();
      options.querySelectorAll('input,textarea').forEach((input,index)=>{
        input.disabled=true;
        if(question.mode==='choice'){
          input.closest('label').dataset.state=index===question.answer_index?'correct':index===selected?'incorrect':'idle';
          input.setAttribute('aria-label',`${index+1}. ${optionTexts[index].textContent}${index===selected?' · em đã chọn':''}${index===question.answer_index?' · đáp án đúng':''}`);
        }
      });
      feedback.hidden=false;feedback.textContent='Đang gửi…';
      section.querySelector('progress').value=round.index+1;await save();
    };
    if(focus){section.querySelector('legend').focus();section.scrollIntoView({block:'nearest'});}
  }
  function renderPracticeSessionAfterReset(){
    if(!currentRun()){invalidateRun();return;}
    cancelPracticeCoach();section.remove();renderPracticeSession(container,item,level,skill);
    container.querySelector('.practice-session legend')?.focus();
  }
  show();
}
