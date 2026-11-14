// OpenJLPT data is loaded by level; the existing Vietnamese lessons remain available.
const lessonLoads = new Map();
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
async function loadTeachingDrafts(level){
  const response=await fetch(`course/${level.toLowerCase()}-teaching.json`);
  if(!response.ok)throw new Error(`Không tải được bộ bài ${level} Việt–Nhật. Hãy thử lại.`);
  const source=await response.json();
  if(source.version!==1 || source.human_approved!==false || !Array.isArray(source.lessons)
    || source.lessons.some(lesson=>lesson.level!==level || lesson.review?.human_approved!==false
      || lesson.eligibility?.reference_display!==true || lesson.eligibility?.provider_teaching!=='advisory_only'
      || lesson.eligibility?.scored_assessment!==false || lesson.eligibility?.mastery_credit!==false
      || !Array.isArray(lesson.tasks)))throw new Error(`Bộ bài ${level} chưa sẵn sàng để học. Em hãy thử lại sau.`);
  for(const lesson of source.lessons){
    const taskPositions=new Map(lesson.tasks.map((task,index)=>[task.id,index]));
    const paths=[lesson.practice_path,lesson.reference_task_ids,...(lesson.guided_steps || []).map(step=>step.task_ids)].filter(path=>path!==undefined);
    if(taskPositions.size!==lesson.tasks.length || paths.some(path=>!Array.isArray(path) || !path.length || new Set(path).size!==path.length || path.some(id=>!taskPositions.has(id)))
      || lesson.delayed_review_task_id && !taskPositions.has(lesson.delayed_review_task_id)
      || lesson.guided_steps?.some(step=>typeof step.title!=='string' || typeof step.note!=='string'
        || !step.example || ['jp','reading','vi'].some(key=>typeof step.example[key]!=='string' || !step.example[key].trim())))
      throw new Error(`Một số bước luyện trong bộ bài ${level} đang có lỗi. Em hãy thử lại sau.`);
    const defaultPath=lesson.practice_path || lesson.guided_steps?.flatMap(step=>step.task_ids) || lesson.tasks.filter(task=>task.exchange?.stage!=='delayed').map(task=>task.id);
    for(const [index,task] of lesson.tasks.entries()){
      const exchange=task.exchange;if(!exchange)continue;
      const priorIds=exchange.prior_task_ids;
      const priors=Array.isArray(priorIds)?priorIds.map(id=>lesson.tasks[taskPositions.get(id)]):null;
      const starts=['invite','produce'].includes(exchange.stage),delayed=exchange.stage==='delayed';
      const requiredStart=['accept','refuse'].includes(exchange.stage)?'invite':'produce';
      const hasRequiredStart=priors?.some(prior=>prior?.exchange?.stage===requiredStart)
        || delayed && priors?.some(prior=>prior?.exchange?.stage==='invite');
      if(!priors || new Set(priorIds).size!==priorIds.length || starts!==(priorIds.length===0)
        || priors.some(prior=>!prior || prior.mode!=='writing' || prior.exchange?.group!==exchange.group
          || prior.exchange.stage==='delayed' || taskPositions.get(prior.id)>=index)
        || !starts && !hasRequiredStart
        || delayed && (lesson.delayed_review_task_id!==task.id || defaultPath.includes(task.id)
          || !priors.some(prior=>['accept','refuse','respond','revise'].includes(prior.exchange.stage)))
        || !delayed && (!defaultPath.includes(task.id) || priorIds.some(id=>!defaultPath.includes(id) || defaultPath.indexOf(id)>=defaultPath.indexOf(task.id)))
        || lesson.reference_task_ids?.includes(task.id)
        || lesson.guided_steps?.some(step=>step.task_ids.includes(task.id)))
        throw new Error(`Chuỗi tự viết trong bộ bài ${level} đang có lỗi. Em hãy thử lại sau.`);
    }
  }
  const titles=new Map(source.lessons.map(lesson=>[lesson.id,lesson.title]));
  return [...source.lessons].sort((a,b)=>a.order-b.order).map(lesson=>({
    ...lesson,lesson:lesson.order,editorial:true,source:`AI-authored ${level} study drafts`,sourceLabel:'VJBot · AI biên soạn · chưa được duyệt độc lập',language:'vi',
    meaning_vi:lesson.goal,summary:lesson.goal,prerequisite_titles:lesson.prerequisites.map(id=>titles.get(id)),
    examples:lesson.examples.map(example=>({...example,ro:example.reading})),
    drills:lesson.tasks.map(task=>({
      task_key:task.id,item_id:task.id,source_identity:task.id,q:task.prompt,
      instruction:task.instruction || '',passage:task.passage || '',
      requires_passage:Boolean(task.passage),skill:task.skill || 'grammar',
      mode:task.mode==='short_text'?'recall':task.mode,
      opts:task.mode==='choice'?task.options.map(option=>option.text):[],
      answer_index:task.mode==='choice'?task.options.findIndex(option=>option.id===task.answer_option_id):null,
      accepted_answers:task.mode==='short_text'?task.accepted_variants:[],
      explanation:task.rationale,source_language:'vi',
      ...(task.objective!==undefined?{objective:task.objective}:{}),
      ...(task.criteria?{criteria:task.criteria}:{}),...(task.model?{model:task.model}:{}),
      ...(task.exchange?{exchange:task.exchange}:{})
    }))
  }));
}
// Select and order original source candidates before translating their labels.
function localizedChoice(q,answer,alternatives,position,item_id){
  const selected=[...alternatives];selected.splice(position,0,answer);
  const opts=selected.map(choice=>choice.vi);
  const collision=new Set(opts.map(text=>String(text).normalize('NFKC').trim().toLocaleLowerCase())).size!==opts.length;
  const unavailable_reason=selected.find(choice=>choice.unavailable_reason)?.unavailable_reason
    || (collision?'Các lựa chọn có nghĩa tiếng Việt trùng nhau. Câu này đang được kiểm tra lại.':'');
  const localization=selected.flatMap(choice=>choice.localization || []);
  return {q,opts,answer_index:selected.indexOf(answer),item_id,source_identity:answer.id,
    option_sources:selected.map(choice=>choice.id),
    ...(localization.length?{localization}:{}),
    ...(unavailable_reason?{unavailable_reason,processing_allowed:false}:{})};
}
function sourceChoicePool(choices){
  const seen=new Set();
  return choices.filter(choice=>{if(seen.has(choice.source_gloss))return false;seen.add(choice.source_gloss);return true;});
}
async function ensureLessons(level) {
  if (!lessonLoads.has(level)) lessonLoads.set(level, (async () => {
    const editorial=await loadTeachingDrafts(level);
    const [vocab,grammar,kanji] = await Promise.all(['vocab','grammar','kanji'].map(async kind => {
      const response = await fetch(`openjlpt/${kind}-${level.toLowerCase()}.json`);
      if(!response.ok) throw new Error('Không tải được bài học. Hãy thử lại.');
      return response.json();
    }));
    const skills=window.JLPT_DATA.curriculum[level].skills;
    const [dict,context]=await Promise.all([loadViDict(),loadViContext()]);
    const identity=(kind,row)=>`openjlpt:${level}:${kind}:${row.id || row.character}`;
    const project=(source_identity,field,japanese,english)=>viText({source_identity,field,japanese,english},dict,context);
    const support=results=>({
      ...(results.some(result=>result.localization)?{localization:results.map(result=>result.localization).filter(Boolean)}:{}),
      ...(results.some(result=>result.processing_allowed===false)?{unavailable_reason:'Nghĩa của mục này đang được kiểm tra lại.',processing_allowed:false}:{})
    });
    const examples=(row,source_identity)=>(row.examples || []).map((e,index)=>{
      const result=project(source_identity,`examples[${index}].en`,e.ja,e.en);
      return {id:`${source_identity}:example:${index}`,source_identity,jp:e.ja,vi:result.text,source_gloss:e.en,
        source:e.tatoeba_id?`https://tatoeba.org/sentences/show/${e.tatoeba_id}`:'',furigana:e.furigana,
        ...support([result])};
    });
    const wordData=(row,kind)=>{
      const id=identity(kind,row),jp=row.word || row.character;
      const results=row.meanings.map((text,index)=>project(id,`meanings[${index}]`,jp,text));
      return {id,jp,source_gloss:row.meanings.join('; '),vi:results.find(result=>result.processing_allowed===false)?.text || results.map(result=>result.text).join('; '),...support(results)};
    };
    const vocabulary=vocab.map(v=>({...wordData(v,'vocabulary'),reading:v.reading,ro:v.romaji,examples:examples(v,identity('vocabulary',v))}));
    for(let i=0;i<vocabulary.length;i+=20)skills.vocabulary.push({lesson:i/20+1,id:`openjlpt:${level}:vocabulary-group:${i/20+1}`,title:`${vocab[i].word} — ${vocab[Math.min(i+19,vocab.length-1)].word}`,summary:`Từ vựng ${i/20+1} · ${Math.min(20,vocab.length-i)} từ`,source:'OpenJLPT',language:'en',items:vocabulary.slice(i,i+20)});
    const vocabularyMeanings=sourceChoicePool(vocabulary);
    for(const lesson of skills.vocabulary.filter(l=>l.source==='OpenJLPT')){
      lesson.drills=lesson.items.map((word,index)=>{
        const candidates=[];
        for(const candidate of vocabularyMeanings){if(candidate.source_gloss!==word.source_gloss)candidates.push(candidate);if(candidates.length>=index+3)break;}
        const alternatives=candidates.slice(index,index+3);
        return localizedChoice(`${word.jp} (${word.reading}) — nghĩa nào đúng?`,word,alternatives,index%4,word.id);
      });
    }
    // Attach parent/example identity before retaining the established Japanese sentence order/deduplication.
    const seen=new Set();
    const sentences=vocab.flatMap((v,index)=>(v.examples || []).map((e,exampleIndex)=>({...e,word:v.word,example:vocabulary[index].examples[exampleIndex]})).filter(e=>e.ja&&e.en&&e.tatoeba_id))
      .filter(e=>{if(seen.has(e.ja))return false;seen.add(e.ja);return true;});
    const vocabularyByWord=new Map();for(const word of vocabulary)if(!vocabularyByWord.has(word.jp))vocabularyByWord.set(word.jp,word);
    for(let i=0;i<sentences.length;i+=10){
      const batch=sentences.slice(i,i+10),number=i/10+1;
      const targetWords=[...new Set(batch.map(e=>e.word))].map(word=>vocabularyByWord.get(word)).filter(Boolean).map(({examples,...word})=>word);
      const common={targetWords,lesson:number,source:'OpenJLPT',language:'en',summary:'Câu ví dụ theo từ vựng',examples:batch.map(e=>e.example)};
      skills.reading.push({...common,id:`sentences:${level}:${number}`,title:`Đọc câu ${number} · ${batch[0].word}`});
      skills.listening.push({...common,id:`listening:${level}:${number}`,title:`Nghe chép câu ${number} · ${batch[0].word}`,dictation:true});
    }
    skills.grammar.push(...grammar.map((g,i)=>{
      const id=identity('grammar',g),meaning=project(id,'meaning',g.pattern,g.meaning),notes=project(id,'notes',g.pattern,g.notes);
      return {lesson:i+1,id,title:viPatternLabel(g.pattern),source_gloss:g.meaning,vi:meaning.text,meaning_vi:meaning.text,
        formula:viFormula(g.formation),explanation:notes.text,reading:g.romaji,
        examples:examples(g,id),source:'OpenJLPT',language:'en',...support([meaning,notes])};
    }));
    skills.kanji=[];
    const kanjiWords=kanji.map(k=>({...wordData(k,'kanji'),reading:[...(k.onyomi || []),...(k.kunyomi || [])].join(' · '),strokes:k.strokes,radical:k.radical,onyomi:k.onyomi || [],kunyomi:k.kunyomi || [],words:k.words || []}));
    for(let i=0;i<kanji.length;i+=20)skills.kanji.push({lesson:i/20+1,id:`openjlpt:${level}:kanji-group:${i/20+1}`,title:`${kanji[i].character} — ${kanji[Math.min(i+19,kanji.length-1)].character}`,summary:`Hán tự ${i/20+1}`,source:'OpenJLPT',language:'en',items:kanjiWords.slice(i,i+20)});
    const makeDrill=(q,answer,choices,id,index)=>{
      const wrong=sourceChoicePool(choices).filter(choice=>choice.source_gloss && choice.source_gloss!==answer.source_gloss);
      const offset=index%Math.max(1,wrong.length-2),alternatives=wrong.slice(offset,offset+3);
      return localizedChoice(q,answer,alternatives,index%(alternatives.length+1),id);
    };
    const grammarMeanings=skills.grammar.filter(l=>l.source==='OpenJLPT');
    for(const lesson of grammarMeanings)lesson.drills=[makeDrill(`Mẫu ${lesson.title} có nghĩa gì?`,lesson,grammarMeanings,lesson.id,lesson.lesson)];
    for(const lesson of skills.kanji)lesson.drills=lesson.items.map((k,i)=>makeDrill(`${k.jp} — nghĩa nào đúng?`,k,kanjiWords,k.id,i));
    for(const lesson of skills.reading.filter(l=>l.source))lesson.drills=lesson.examples.map((example,index)=>({
      ...makeDrill('Em chọn nghĩa phù hợp với câu này nhé.',example,lesson.examples,`${lesson.id}:${index}`,index),
      passage:example.jp,requires_passage:true,example_indexes:[index]
    }));
    if(level==='N5') {
      const rows=[['あいうえお','アイウエオ',['a','i','u','e','o']],['かきくけこ','カキクケコ',['ka','ki','ku','ke','ko']],['さしすせそ','サシスセソ',['sa','shi','su','se','so']],['たちつてと','タチツテト',['ta','chi','tsu','te','to']],['なにぬねの','ナニヌネノ',['na','ni','nu','ne','no']],['はひふへほ','ハヒフヘホ',['ha','hi','fu','he','ho']],['まみむめも','マミムメモ',['ma','mi','mu','me','mo']],['やゆよ','ヤユヨ',['ya','yu','yo']],['らりるれろ','ラリルレロ',['ra','ri','ru','re','ro']],['わをん','ワヲン',['wa','wo','n']]];
      skills.kana=rows.flatMap((row,index)=>[0,1].map(kind=>{
        const name=kind?'Katakana':'Hiragana',items=[...row[kind]].map((jp,i)=>({id:`kana:${name}:${jp}`,jp,reading:row[2][i],vi:''}));
        const choices=rows.flatMap(r=>r[2]).map(reading=>({id:`kana:reading:${reading}`,source_gloss:reading,vi:reading}));
        return {id:`kana:${name}:${index}`,lesson:index+1,title:`${name} · ${row[kind]}`,summary:'Bảng chữ cái cơ bản',explanation:index===9?'を thường được đọc là o khi làm trợ từ. ん là âm mũi, không thêm nguyên âm.':'Đọc từng chữ, nghe mẫu rồi chọn cách đọc trong phần luyện tập.',items,drills:items.map((w,i)=>makeDrill(`Cách đọc của ${w.jp}?`,{id:w.id,source_gloss:w.reading,vi:w.reading},choices,w.id,i))};
      }));
    }
    skills.grammar.unshift(...editorial);
  })().catch(error => {lessonLoads.delete(level);throw error;}));
  return lessonLoads.get(level);
}
function furiganaHtml(value) {
  return escapeHtml(value).replace(/\{([^{}|]+)\|([^{}|]+)\}/g,'<ruby>$1<rt>$2</rt></ruby>');
}
window.furiganaHtml=furiganaHtml;
window.escapeHtml=escapeHtml;
window.ensureLessons=ensureLessons;
const taskReferences=new WeakMap(),taskAttempts=new Map();
let taskAttemptAccount=null;
async function taskReference(task){
  const source=taskRevisionSource(task),cached=taskReferences.get(task);
  if(cached?.source===source)return cached.reference;
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(source));
  const reference={id:task.task_id,revision:Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('')};
  taskReferences.set(task,{source,reference});return reference;
}
function taskAttempt(lesson,task,index,view='checks',fresh=false){
  const account=typeof signedInUser==='undefined'?null:signedInUser?.user_id;
  if(account!==taskAttemptAccount){taskAttempts.clear();taskAttemptAccount=account;}
  const key=JSON.stringify([lesson.level,lesson.id,view,task.task_id]),source=taskRevisionSource(task);
  let attempt=taskAttempts.get(key);
  if(fresh || !attempt || attempt.source!==source){
    attempt={id:crypto.randomUUID(),lesson,task,index,view,source,account,assisted:false};
    taskAttempts.set(key,attempt);
  }
  return attempt;
}
async function recordTaskEvent(attempt,event,extra={}){
  const task=await taskReference(attempt.task);
  const account=typeof signedInUser==='undefined'?null:signedInUser?.user_id;
  if(account!==attempt.account)throw new Error('Tài khoản đã thay đổi. Mở lại bài trước khi lưu.');
  const response=await apiFetch('/api/progress/record',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({lesson:attempt.lesson,view:attempt.view,question_index:attempt.index,task,
      attempt_id:attempt.id,...(attempt.sessionId?{session_id:attempt.sessionId}:{}),event,...extra})});
  const result=await response.json();
  if((typeof signedInUser==='undefined'?null:signedInUser?.user_id)!==attempt.account)throw new Error('Tài khoản đã thay đổi. Mở lại bài để xem câu trả lời của tài khoản hiện tại.');
  if(!response.ok)throw new Error(result.detail || 'Chưa lưu được lượt học. Hãy thử lại.');
  if(event==='assist')attempt.assisted=true;
  return result;
}
function focusedTaskAttempt(lesson,focus,view='checks',question=null){
  if(focus?.kind!=='question')return null;
  if(!question){
    const live=globalThis.teacherContext?.();
    if(live?.lesson?.id===lesson.id && live.lesson.level===lesson.level && live.focus?.index===focus.index)question=live.task;
  }
  if(!question)return null;
  return taskAttempt(lesson,question,focus.index,view);
}
function taskInstruction(task){
  const instruction=String(task.instruction || '');
  return task.parts?.length && /^Sắp xếp/u.test(instruction)
    ?instruction.replace(/\s*\[\s*\d+\s*:[^\]]+\]/gu,'').replace(/[:：]\s*$/u,'').trim()
    :instruction;
}
function taskPromptHtml(task){
  const text=String(task.q || ''),candidate=String(task.target || ''),instruction=taskInstruction(task);
  const target=candidate && text.includes(candidate) && !/^[_\s★]+$/.test(candidate)?candidate:'';
  const offset=target?text.indexOf(target):-1;
  const prompt=offset<0?escapeHtml(text):`${escapeHtml(text.slice(0,offset))}<mark>${escapeHtml(target)}</mark>${escapeHtml(text.slice(offset+target.length))}`;
  const instructional=['writing','recall'].includes(task.mode) || text.includes('\n\n');
  const content=instructional?prompt.split(/\n{2,}/u).map(block=>`<p>${block}</p>`).join(''):prompt;
  return `${task.passage?`<section class="task-stimulus" aria-label="Ngữ cảnh để trả lời"><p lang="ja">${escapeHtml(task.passage)}</p></section>`:''}
    ${instruction?`<p class="task-instruction">${escapeHtml(instruction)}</p>`:''}
    ${target?`<span class="task-accessible-target">Từ được gạch chân: <span lang="ja">${escapeHtml(target)}</span>.</span>`:''}
    ${instructional?`<div class="task-stem task-instruction-prompt${task.mode==='writing'?' task-writing-prompt':''}" lang="vi">${content}</div>`:`<p class="task-stem" lang="ja">${prompt}</p>`}
    ${task.parts?.length?`<ol class="task-parts" role="list" aria-label="Các phần cần sắp xếp">${task.parts.map(part=>`<li lang="ja">${escapeHtml(part)}</li>`).join('')}</ol>`:''}`;
}
function taskUnavailableMessage(task){
  return task.review_status==='quarantined'?'Câu này đang được kiểm tra lại.':task.unavailable_reason;
}
function renderLessonExercises(item,level,skill=activeCurriculumSkill) {
  const container=document.getElementById('lesson-exercises'),questions=lessonQuestions(item,level,skill);
  const lesson=buildLessonContext(item,level,skill);
  if(item.production){
    const source=item.production,question=questions[0],section=document.createElement('section');section.className='production-task';
    if(!question || question.unavailable_reason){section.textContent=question?taskUnavailableMessage(question):'Bài này chưa có bài tập viết. Em có thể chọn bài khác.';container.append(section);return;}
    const attempt=taskAttempt(lesson,question,0,'checks',true);
    section.dataset.teacherQuestion='0';
    section.innerHTML=`${taskPromptHtml(question)}
      ${question.explanation?`<p class="task-instruction">${escapeHtml(question.explanation)}</p>`:''}
      <label for="production-answer">Câu trả lời của em</label><textarea id="production-answer" rows="5" maxlength="4000" lang="ja" placeholder="Viết bằng tiếng Nhật…"></textarea>
      <button type="button" class="production-reveal"${question.model?'':' hidden'}>Xem bài mẫu</button><div class="production-model" hidden><p lang="ja">${escapeHtml(question.model)}</p><p>Bài mẫu để tham khảo, chưa được kiểm tra độc lập.</p></div>
      <section class="task-writing-criteria"><h4>Thầy sẽ xem những điểm này</h4><ul>${source.criteria.map(criterion=>`<li>${escapeHtml(criterion)}</li>`).join('')}</ul></section>
      <div class="practice-actions"><button type="button" class="production-save">Gửi thầy nhận xét</button></div><output aria-live="polite"></output>`;
    container.append(section);
    const input=section.querySelector('textarea'),save=section.querySelector('.production-save'),status=section.querySelector('output'),reveal=section.querySelector('.production-reveal');
    input.addEventListener('focus',()=>globalThis.setTeacherFocus?.({kind:'question',index:0}));
    reveal.onclick=async()=>{
      if(!question.model)return;
      reveal.disabled=true;
      try{await recordTaskEvent(attempt,'assist',{help:'source_reveal',response_text:input.value});section.querySelector('.production-model').hidden=false;reveal.hidden=true;}
      catch(error){status.textContent='Chưa mở được bài mẫu. '+error.message+' Bấm "Xem bài mẫu" để thử lại.';reveal.disabled=false;}
    };
    let removeCoach=globalThis.mountPracticeCoach?.(section,container,lesson,question,0,null);
    let pending=null;
    apiFetch('/api/progress').then(response=>response.ok?response.json():null).then(data=>{
      const saved=data?.evidence?.find(row=>row.item_id===item.id && row.response_text) || data?.items?.find(row=>row.item_id===item.id);
      if(saved?.response_text && !input.value && section.isConnected && (typeof signedInUser==='undefined'?null:signedInUser?.user_id)===attempt.account){input.value=saved.response_text;status.textContent='Đã khôi phục bài viết đã lưu.';}
    }).catch(()=>{status.textContent='Chưa tải được bài viết cũ. Mở lại bài để thử tải lại.';});
    save.onclick=async()=>{
      if(!input.value.trim()){status.textContent='Em hãy viết câu trả lời trước khi gửi thầy.';input.focus();return;}
      if(!pending)pending={response_text:input.value};
      save.disabled=true;save.textContent='Đang gửi…';input.disabled=true;
      try{
        await recordTaskEvent(attempt,'answer',pending);
        if(!section.isConnected || container.hidden)return;
        status.textContent='Đã gửi bài.';
        save.textContent='Đã gửi';reveal.disabled=false;
        removeCoach?.();
        removeCoach=globalThis.mountPracticeCoach?.(section,container,lesson,question,0,{selected:pending.response_text,correct:null,saved:true});
      }catch(error){status.textContent='Chưa gửi được bài. '+error.message;save.textContent='Thử lại';save.disabled=false;}
    };
    return;
  }
  if(item.dictation){
    for(const [index,example] of (item.examples || []).entries()){
      const question=questions[index],section=document.createElement('section');section.className='lesson-exercise';
      if(!question || question.unavailable_reason){section.textContent=question?taskUnavailableMessage(question):'Câu nghe này chưa mở được. Em có thể chọn câu khác.';container.append(section);continue;}
      const attempt=taskAttempt(lesson,question,index,'checks',true);
      const select=()=>globalThis.setTeacherFocus?.({kind:'question',index});
      const play=document.createElement('button');play.type='button';play.textContent=`Nghe câu ${index+1}`;
      play.onclick=()=>{select();playGeminiTTS(example.furigana || example.jp,{language:'ja-JP',lesson,focus:{kind:'question',index},task:question});};
      const input=document.createElement('textarea');input.setAttribute('aria-label',`Chép câu ${index+1} bằng tiếng Nhật`);input.lang='ja';input.rows=2;input.maxLength=4000;input.addEventListener('focus',select);
      const reveal=document.createElement('button');reveal.type='button';reveal.textContent='Xem lời thoại';
      const answer=document.createElement('div');answer.hidden=true;
      answer.innerHTML=`<p lang="ja">${furiganaHtml(example.furigana || example.jp)}</p><p>${escapeHtml(example.vi)}</p><p>Em so bản chép với lời thoại rồi tự đánh giá nhé. Ứng dụng chưa chấm bài nghe.</p>`;
      const status=document.createElement('output');status.setAttribute('aria-live','polite');
      reveal.onclick=async()=>{
        select();
        if(!input.value.trim()){status.textContent='Em chép thử trước khi xem lời thoại nhé.';input.focus();return;}
        const submitted=input.value;reveal.disabled=true;input.readOnly=true;
        try{
          await recordTaskEvent(attempt,'assist',{help:'source_reveal',response_text:submitted});
          input.value=submitted;answer.hidden=false;
        }catch(error){status.textContent='Chưa mở được lời thoại. '+error.message+' Bấm "Xem lời thoại" để thử lại.';reveal.disabled=false;input.readOnly=false;}
      };
      let pending=null;
      for(const [label,rating] of [['Em tự thấy đã hiểu',4],['Em cần ôn lại',1]]){
        const save=document.createElement('button');save.type='button';save.textContent=label;
        save.onclick=async()=>{
          if(!pending)pending={response_text:input.value,self_rating:rating};
          answer.querySelectorAll('button').forEach(button=>button.disabled=true);
          try{await recordTaskEvent(attempt,'answer',pending);status.textContent='Đã lưu bản chép và tự đánh giá.';}
          catch(error){status.textContent='Chưa lưu được bản chép. '+error.message+' Bấm lại lựa chọn tự đánh giá để thử lại.';answer.querySelectorAll('button').forEach(button=>button.disabled=false);}
        };answer.append(save);
      }
      section.append(play,input,reveal,answer,status);container.append(section);
      globalThis.mountStudyTeacher?.(answer,{lesson,focus:{kind:'question',index},task:question,
        isCurrent:()=>!container.hidden && !answer.hidden});
    }
    return;
  }
  if(!questions.length){const empty=document.createElement('p');empty.textContent='Bài này chưa có bài tập. Em vẫn có thể đọc phần tham khảo.';container.append(empty);return;}
  renderPracticeSession(container,item,level,skill);
}


function buildLessonContext(item,level,skill){
  return {id:activityId(item,level,skill),level};
}
