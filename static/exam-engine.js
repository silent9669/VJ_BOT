let examConfig=null,simulation=null,simulationPaper=null,simulationInterval=null,simulationSaving=Promise.resolve(),simulationSaveVersion=0,simulationSavedVersion=0;
async function loadExamConfig(){
  if(!examConfig){const response=await fetch('course/exams.json');if(!response.ok)throw new Error('catalog');examConfig=await response.json();}
  return examConfig;
}
function sectionQuestions(section){
  let sequence=0;
  return section.groups.flatMap(g=>g.answers.map((answer,index)=>({answer,group:g.number,label:`${g.number} · ${g.labels?.[index] || index+1}`,index:sequence++})));
}
function examRawScore(paper,answers){
  return paper.sections.map((s,i)=>{const questions=sectionQuestions(s);return {title:s.title,total:questions.length,answered:questions.filter((q,j)=>answers[i]?.[j]!=null).length,correct:questions.filter((q,j)=>answers[i]?.[j]===q.answer).length};});
}
function freshSimulation(paper){return {paper_id:`${paper.level}:${paper.year}`,section:0,status:'ready',deadline:0,answers:paper.sections.map(s=>sectionQuestions(s).map(()=>null))};}
async function saveSimulation(attempt=simulation,version=featureVersion){
  const body=JSON.stringify(attempt),saveVersion=++simulationSaveVersion;
  const save=async()=>{
    const response=await apiFetch('/api/exam-attempts',{method:'POST',headers:{'Content-Type':'application/json'},body,keepalive:true});
    if(!response.ok)throw new Error('save');
  };
  const pending=simulationSaving.then(save,save);simulationSaving=pending.catch(()=>{});
  try{await pending;simulationSavedVersion=Math.max(simulationSavedVersion,saveVersion);const status=version===featureVersion?document.getElementById('simulation-save'):null;if(status)status.textContent='Đã lưu';return true;}
  catch{const status=version===featureVersion?document.getElementById('simulation-save'):null;if(status){status.textContent='Chưa lưu được. ';const retry=document.createElement('button');retry.textContent='Lưu lại';retry.onclick=()=>saveSimulation(attempt,version);status.append(retry);}return false;}
}
async function renderSimulation(level,year){
  const host=document.getElementById('simulation-workspace');host.textContent='Đang tải bài thi…';
  const version=featureVersion;
  const paper=examConfig.papers.find(p=>p.level===level && p.year===year);
  try{
    await simulationSaving;
    const response=await apiFetch(`/api/exam-attempts?paper_id=${level}:${year}`);if(!response.ok)throw new Error('load');
    const data=await response.json();if(version!==featureVersion)return;
    simulationPaper=paper;simulation=data.attempt || freshSimulation(paper);drawSimulation();
  }catch{if(version!==featureVersion)return;host.textContent='Chưa tải được bài thi đã lưu. ';const retry=document.createElement('button');retry.textContent='Thử lại';retry.onclick=()=>renderSimulation(level,year);host.append(retry);}
}
function drawSimulation(){
  clearInterval(simulationInterval);
  const host=document.getElementById('simulation-workspace'),paper=simulationPaper,attempt=simulation,version=featureVersion;
  if(simulation.status==='finished'){renderSimulationResult();return;}
  if(simulation.status==='ready' || simulation.status==='break'){
    const next=paper.sections[simulation.section];
    host.innerHTML=`<header class="workspace-heading"><h1>${paper.level} · Đề chính thức ${paper.year}</h1></header><p class="exam-source-note">Mở đề PDF bên cạnh hoặc in trước khi thi. Điền đáp án tại đây; hết giờ khóa phần hiện tại. Đồng hồ tiếp tục khi đóng trang. Thời gian áp dụng cấu trúc JLPT hiện nay; số câu và độ dài audio của đề ${paper.year} có thể khác kỳ thi hiện tại.</p><ol class="simulation-section-list">${paper.sections.map((s,i)=>`<li><span>${i+1}. ${s.title}${i<simulation.section?' · Đã nộp':''}</span><span>${s.minutes} phút</span></li>`).join('')}</ol><div class="simulation-resources"><a href="${paper.sheet_url}" target="_blank" rel="noopener">Phiếu trả lời gốc ↗</a><a href="${paper.source_url}" target="_blank" rel="noopener">Nguồn đề chính thức ↗</a></div><h2>${simulation.status==='break'?'Nghỉ giữa hai phần':'Sẵn sàng bắt đầu?'}</h2><p class="exam-source-note">Phần tiếp theo: ${next.title}. Không thể quay lại phần đã nộp.</p><button class="simulation-start" id="simulation-start">Bắt đầu · ${next.minutes} phút</button><output id="simulation-save" class="simulation-status" aria-live="polite"></output>`;
    document.getElementById('simulation-start').onclick=async event=>{event.target.disabled=true;simulation.status='running';simulation.deadline=Date.now()+next.minutes*60000;const saved=await saveSimulation(attempt,version);if(version!==featureVersion)return;if(saved)drawSimulation();else{attempt.status=attempt.section?'break':'ready';attempt.deadline=0;event.target.disabled=false;}};
    return;
  }
  if(Date.now()>=simulation.deadline){endSimulationSection();return;}
  const section=paper.sections[simulation.section],questions=sectionQuestions(section);
  host.innerHTML=`<div class="simulation-header"><div><span>${paper.level} · ${paper.year} · Phần ${simulation.section+1}</span><h2>${section.title}</h2></div><time id="simulation-clock" aria-label="Thời gian còn lại"></time></div><div class="simulation-resources">${section.documents.map(d=>`<a href="${d.url}" target="_blank" rel="noopener">Mở đề ${d.title} ↗</a>`).join('')}</div>${section.audio.length?`<div class="simulation-audio"><label for="simulation-audio">Âm thanh chính thức · nghe theo thứ tự</label><audio id="simulation-audio" controls preload="none" src="${section.audio[0]}"></audio><span id="simulation-track">Track 1 / ${section.audio.length}</span><a id="simulation-audio-link" href="${section.audio[0]}" target="_blank" rel="noopener">Mở audio riêng ↗</a></div>`:''}<p class="exam-source-note">Chọn đáp án theo số Mondai và số câu trên phiếu. Không xem đáp án trong khi làm bài.</p>${section.groups.map(g=>`<h3 class="simulation-group-title">問題 ${g.number}</h3><div class="answer-sheet">${questions.filter(q=>q.group===g.number).map(q=>`<fieldset><legend>${q.label}</legend>${Array.from({length:g.choices || 4},(_,i)=>i+1).map(value=>`<label><input type="radio" name="exam-${q.index}" value="${value}" data-question="${q.index}" ${simulation.answers[simulation.section]?.[q.index]===value?'checked':''}><span>${value}</span></label>`).join('')}</fieldset>`).join('')}</div>`).join('')}<output id="simulation-save" class="simulation-status" aria-live="polite"></output><div class="simulation-actions"><button id="simulation-submit">Nộp phần này</button></div><dialog id="simulation-confirm" aria-labelledby="simulation-confirm-title"><h2 id="simulation-confirm-title">Nộp phần hiện tại?</h2><p id="simulation-unanswered"></p><p>Đáp án phần này sẽ được khóa.</p><div class="simulation-actions"><button class="secondary" id="simulation-cancel">Làm tiếp</button><button id="simulation-confirm-submit">Nộp bài</button></div></dialog>`;
  host.querySelectorAll('[data-question]').forEach(input=>input.onchange=()=>{if(!chooseSimulationAnswer(attempt,Number(input.dataset.question),Number(input.value))){endSimulationSection();return;}saveSimulation(attempt,version);});
  if(section.audio.length){
    let track=0;const audio=document.getElementById('simulation-audio');
    audio.onended=()=>{if(++track<section.audio.length){audio.src=section.audio[track];document.getElementById('simulation-track').textContent=`Track ${track+1} / ${section.audio.length}`;document.getElementById('simulation-audio-link').href=section.audio[track];audio.play().catch(()=>{});}else document.getElementById('simulation-track').textContent='Đã hết audio';};
  }
  const dialog=document.getElementById('simulation-confirm');
  document.getElementById('simulation-submit').onclick=()=>{document.getElementById('simulation-unanswered').textContent=`${simulation.answers[simulation.section].filter(a=>a===null).length} câu chưa trả lời.`;dialog.showModal();};
  document.getElementById('simulation-cancel').onclick=()=>dialog.close();document.getElementById('simulation-confirm-submit').onclick=()=>{dialog.close();endSimulationSection();};
  function tick(){const remaining=Math.max(0,Math.ceil((simulation.deadline-Date.now())/1000));const clock=document.getElementById('simulation-clock');if(clock)clock.textContent=`${Math.floor(remaining/60).toString().padStart(2,'0')}:${(remaining%60).toString().padStart(2,'0')}`;if(!remaining)endSimulationSection();}
  simulationInterval=setInterval(tick,1000);tick();
}
function chooseSimulationAnswer(attempt,index,value,now=Date.now()){
  if(attempt.status!=='running' || now>=attempt.deadline)return false;
  attempt.answers[attempt.section][index]=value;return true;
}
let endingSimulation=null;
async function endSimulationSection(){
  if(endingSimulation===simulation || simulation.status!=='running')return;
  const attempt=simulation,paper=simulationPaper,version=featureVersion;
  endingSimulation=attempt;clearInterval(simulationInterval);
  document.getElementById('simulation-audio')?.pause();document.getElementById('simulation-confirm')?.close();
  document.querySelectorAll('#simulation-workspace input,#simulation-submit').forEach(el=>el.disabled=true);
  if(simulation.section===simulationPaper.sections.length-1)simulation.status='finished';
  else{simulation.section++;simulation.status='break';}
  simulation.deadline=0;
  const saved=await saveSimulation(attempt,version);if(endingSimulation===attempt)endingSimulation=null;if(version!==featureVersion)return;drawSimulation();
  if(!saved){const status=document.getElementById('simulation-save');status.textContent='Chưa lưu được phần vừa nộp. ';const retry=document.createElement('button');retry.textContent='Lưu lại';retry.onclick=()=>saveSimulation(attempt,version);status.append(retry);}
}
function renderSimulationResult(){
  const host=document.getElementById('simulation-workspace'),paper=simulationPaper,results=examRawScore(paper,simulation.answers);
  const correct=results.reduce((n,s)=>n+s.correct,0),total=results.reduce((n,s)=>n+s.total,0);
  host.innerHTML=`<header class="workspace-heading"><div><h1>${paper.level} · Kết quả luyện thi</h1><p>${correct} / ${total} câu đúng</p></div></header><p class="exam-source-note">Điểm thô đối chiếu đáp án chính thức. JLPT dùng điểm chuẩn hóa; kết quả này không xác định đỗ/trượt.</p><table class="exam-review-table"><thead><tr><th>Phần</th><th>Đã trả lời</th><th>Đúng</th></tr></thead><tbody>${results.map(s=>`<tr><th>${s.title}</th><td>${s.answered}/${s.total}</td><td>${s.correct}/${s.total}</td></tr>`).join('')}</tbody></table><div class="simulation-resources"><a href="${paper.answer_url}" target="_blank" rel="noopener">Đối chiếu đáp án gốc ↗</a></div>${paper.sections.map((s,i)=>`<details><summary class="simulation-group-title">${s.title} · Xem đáp án</summary><table class="exam-review-table"><thead><tr><th>Câu</th><th>Em chọn</th><th>Đáp án</th></tr></thead><tbody>${sectionQuestions(s).map((q,j)=>`<tr class="${simulation.answers[i]?.[j]===q.answer?'answer-correct':'answer-wrong'}"><th>${q.label}</th><td>${simulation.answers[i]?.[j] || '—'}</td><td>${q.answer}</td></tr>`).join('')}</tbody></table></details>`).join('')}<div id="simulation-completion"></div><output id="simulation-save" class="simulation-status" aria-live="polite"></output><div class="simulation-actions"><button id="simulation-again">Làm lại đề</button><a href="#quiz/${paper.level}">Chọn đề khác ↗</a></div>`;
  mountCompletion(document.getElementById('simulation-completion'),{activity_id:`simulation:${paper.level}:${paper.year}`,kind:'test',level:paper.level,title:`JLPT ${paper.year} · mô phỏng`});
  document.getElementById('simulation-again').onclick=async()=>{if(!confirm('Làm lại sẽ thay thế bài thi đã lưu của đề này.'))return;const version=featureVersion;simulation=freshSimulation(paper);if(await saveSimulation() && version===featureVersion)drawSimulation();};
}
