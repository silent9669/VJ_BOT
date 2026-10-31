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
function renderPracticeSession(container,item,level,skill,record){
  const questions=lessonQuestions(item,level,skill);
  let round=createPracticeRound(questions),review=false;
  const section=document.createElement('section');section.className='practice-session';container.append(section);
  const completion=document.getElementById('lesson-completion');
  function show(focus=false){
    section.replaceChildren();
    if(round.index===round.indices.length){
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
    section.innerHTML=`<div class="practice-meter"><span>${review?'Ôn câu sai':'Luyện tập'}</span><span>${round.index+1} / ${round.indices.length}</span><progress value="${round.index}" max="${round.indices.length}" aria-label="Câu đã làm"></progress></div><fieldset><legend tabindex="-1">${escapeHtml(q.q)}</legend><div class="practice-options"></div></fieldset><div class="practice-feedback" role="status" hidden></div><div class="practice-actions"><button type="button" class="practice-primary" disabled>Kiểm tra</button></div>`;
    const options=section.querySelector('.practice-options'),action=section.querySelector('.practice-primary'),feedback=section.querySelector('.practice-feedback');
    let selected=null,pending=null;
    for(const [i,option] of q.opts.entries()){
      const label=document.createElement('label');label.className='practice-option';
      const input=document.createElement('input');input.type='radio';input.name='practice-answer';input.value=String(i);
      const number=document.createElement('span');number.className='practice-option-number';number.textContent=String(i+1);
      const text=document.createElement('span');text.textContent=option;
      input.onchange=()=>{selected=option;action.disabled=false;};label.append(input,number,text);options.append(label);
    }
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
      const message=(answer.correct?'Chính xác.':`Đáp án: ${q.ans}.`)+(q.explanation?' '+q.explanation:'');
      pending={...answer,id:crypto.randomUUID(),feedback:message};
      options.querySelectorAll('input').forEach((input,i)=>{input.disabled=true;input.closest('label').dataset.state=q.opts[i]===q.ans?'correct':q.opts[i]===selected?'incorrect':'idle';});
      feedback.hidden=false;feedback.dataset.correct=String(answer.correct);feedback.textContent=message;
      section.querySelector('progress').value=round.index+1;
      await save();
    };
    if(focus){section.querySelector('legend').focus();section.scrollIntoView({block:'nearest'});}
  }
  show();
}
