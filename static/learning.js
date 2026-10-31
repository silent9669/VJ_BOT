// OpenJLPT data is loaded by level; the existing Vietnamese lessons remain available.
const lessonLoads = new Map();
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
async function ensureLessons(level) {
  if (!lessonLoads.has(level)) lessonLoads.set(level, (async () => {
    const [vocab,grammar,kanji] = await Promise.all(['vocab','grammar','kanji'].map(async kind => {
      const response = await fetch(`openjlpt/${kind}-${level.toLowerCase()}.json`);
      if(!response.ok) throw new Error('Không tải được bài học. Hãy thử lại.');
      return response.json();
    }));
    const skills=window.JLPT_DATA.curriculum[level].skills;
    const examples = row => (row.examples || []).map(e => ({jp:e.ja,vi:e.en,source:e.tatoeba_id ? `https://tatoeba.org/sentences/show/${e.tatoeba_id}` : '',furigana:e.furigana}));
    for(let i=0;i<vocab.length;i+=20) skills.vocabulary.push({lesson:i/20+1,id:`openjlpt:${level}:vocabulary-group:${i/20+1}`,title:`${vocab[i].word} — ${vocab[Math.min(i+19,vocab.length-1)].word}`,summary:`Từ vựng ${i/20+1} · ${Math.min(20,vocab.length-i)} từ`,source:'OpenJLPT',language:'en',items:vocab.slice(i,i+20).map(v=>({id:`openjlpt:${level}:vocabulary:${v.id}`,jp:v.word,reading:v.reading,ro:v.romaji,vi:v.meanings.join('; '),examples:examples(v)}))});
    const vocabularyMeanings=[...new Set(vocab.map(v=>v.meanings.join('; ')))];
    // Recognition drills use distinct source glosses, with a stable item ID for progress.
    for(const lesson of skills.vocabulary.filter(l=>l.source==='OpenJLPT')) {
      lesson.drills=lesson.items.map((word,index)=>{
        const alternatives=vocabularyMeanings.filter(m=>m!==word.vi).slice(index,index+3);
        const opts=[...alternatives];opts.splice(index%4,0,word.vi);
        return {q:`${word.jp} (${word.reading}) — nghĩa nào đúng?`,opts,ans:word.vi,item_id:word.id};
      });
    }
    // Sentence practice is grouped by the target word's level; sentences are not graded JLPT passages.
    const seen=new Set();
    const sentences=vocab.flatMap(v=>(v.examples||[]).filter(e=>e.ja&&e.en&&e.tatoeba_id).map(e=>({...e,word:v.word}))).filter(e=>{if(seen.has(e.ja))return false;seen.add(e.ja);return true;});
    for(let i=0;i<sentences.length;i+=10) {
      const batch=sentences.slice(i,i+10),number=i/10+1;
      const targetWords=[...new Set(batch.map(e=>e.word))].map(word=>vocab.find(v=>v.word===word)).filter(Boolean).map(v=>({jp:v.word,reading:v.reading,vi:v.meanings.join('; ')}));
      const common={targetWords,lesson:number,source:'OpenJLPT',language:'en',summary:'Câu ví dụ theo từ vựng · bản dịch tiếng Anh',examples:batch.map(e=>({jp:e.ja,vi:e.en,source:`https://tatoeba.org/sentences/show/${e.tatoeba_id}`,furigana:e.furigana}))};
      skills.reading.push({...common,id:`sentences:${level}:${number}`,title:`Đọc câu ${number} · ${batch[0].word}`});
      skills.listening.push({...common,id:`listening:${level}:${number}`,title:`Nghe chép câu ${number} · ${batch[0].word}`,dictation:true});
    }
    skills.grammar.push(...grammar.map((g,i)=>({lesson:i+1,id:`openjlpt:${level}:grammar:${g.id}`,title:g.pattern,meaning_vi:g.meaning,formula:g.formation,explanation:g.notes,reading:g.romaji,examples:examples(g),source:'OpenJLPT',language:'en'})));
    skills.kanji=[];
    for(let i=0;i<kanji.length;i+=20) skills.kanji.push({lesson:i/20+1,id:`openjlpt:${level}:kanji-group:${i/20+1}`,title:`${kanji[i].character} — ${kanji[Math.min(i+19,kanji.length-1)].character}`,summary:`Hán tự ${i/20+1}`,source:'OpenJLPT',language:'en',items:kanji.slice(i,i+20).map(k=>({id:`openjlpt:${level}:kanji:${k.character}`,jp:k.character,reading:[...(k.onyomi||[]),...(k.kunyomi||[])].join(' · '),vi:k.meanings.join('; '),strokes:k.strokes,radical:k.radical,onyomi:k.onyomi||[],kunyomi:k.kunyomi||[],words:k.words||[]}))});
    const makeDrill=(q,answer,choices,id,index)=>{
      const wrong=[...new Set(choices)].filter(x=>x&&x!==answer);
      const offset=index%Math.max(1,wrong.length-2),opts=wrong.slice(offset,offset+3);
      opts.splice(index%(opts.length+1),0,answer);return {q,ans:answer,opts,item_id:id};
    };
    for(const lesson of skills.grammar.filter(l=>l.source))lesson.drills=[makeDrill(`Mẫu ${lesson.title} có nghĩa gì?`,lesson.meaning_vi,grammar.map(g=>g.meaning),lesson.id,lesson.lesson)];
    for(const lesson of skills.kanji)lesson.drills=lesson.items.map((k,i)=>makeDrill(`${k.jp} — nghĩa nào đúng?`,k.vi,kanji.map(k=>k.meanings.join('; ')),k.id,i));
    for(const lesson of skills.reading.filter(l=>l.source))lesson.drills=lesson.examples.slice(0,5).map((e,i)=>makeDrill(`Chọn bản dịch: ${e.jp}`,e.vi,lesson.examples.map(e=>e.vi),`${lesson.id}:${i}`,i));
    if(level==='N5') {
      const rows=[['あいうえお','アイウエオ',['a','i','u','e','o']],['かきくけこ','カキクケコ',['ka','ki','ku','ke','ko']],['さしすせそ','サシスセソ',['sa','shi','su','se','so']],['たちつてと','タチツテト',['ta','chi','tsu','te','to']],['なにぬねの','ナニヌネノ',['na','ni','nu','ne','no']],['はひふへほ','ハヒフヘホ',['ha','hi','fu','he','ho']],['まみむめも','マミムメモ',['ma','mi','mu','me','mo']],['やゆよ','ヤユヨ',['ya','yu','yo']],['らりるれろ','ラリルレロ',['ra','ri','ru','re','ro']],['わをん','ワヲン',['wa','wo','n']]];
      skills.kana=rows.flatMap((row,index)=>[0,1].map(kind=>{
        const name=kind?'Katakana':'Hiragana',items=[...row[kind]].map((jp,i)=>({id:`kana:${name}:${jp}`,jp,reading:row[2][i],vi:''}));
        return {id:`kana:${name}:${index}`,lesson:index+1,title:`${name} · ${row[kind]}`,summary:'Bảng chữ cái cơ bản',explanation:index===9?'を thường được đọc là o khi làm trợ từ. ん là âm mũi, không thêm nguyên âm.':'Đọc từng chữ, nghe mẫu rồi chọn cách đọc trong phần luyện tập.',items,drills:items.map((w,i)=>makeDrill(`Cách đọc của ${w.jp}?`,w.reading,rows.flatMap(r=>r[2]),w.id,i))};
      }));
    }
  })().catch(error => {lessonLoads.delete(level);throw error;}));
  return lessonLoads.get(level);
}
function furiganaHtml(value) {
  return escapeHtml(value).replace(/\{([^{}|]+)\|([^{}|]+)\}/g,'<ruby>$1<rt>$2</rt></ruby>');
}
window.furiganaHtml=furiganaHtml;
window.escapeHtml=escapeHtml;
window.ensureLessons=ensureLessons;
function renderLessonExercises(item,level,skill=activeCurriculumSkill) {
  const container=document.getElementById('lesson-exercises');
  const questions=lessonQuestions(item,level,skill);
  async function record(id,correct,display,attempt_id,response_text){
    const response=await apiFetch('/api/progress/record',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({item_id:id,display,level,item_type:skill,correct,quality:correct?4:1,attempt_id,response_text})});
    if(!response.ok)throw new Error('save');
  }
  if(item.production){
    const task=item.production,section=document.createElement('section');section.className='production-task';
    section.innerHTML=`<h3>${escapeHtml(task.prompt)}</h3><label for="production-answer">Câu trả lời của em</label><textarea id="production-answer" rows="5" maxlength="4000" placeholder="Viết bằng tiếng Nhật…"></textarea><details><summary>Đối chiếu câu mẫu</summary><p lang="ja">${escapeHtml(task.model)}</p></details><fieldset><legend>Tự kiểm tra câu trả lời</legend>${task.criteria.map((c,i)=>`<label><input type="checkbox" value="${i}"> ${escapeHtml(c)}</label>`).join('')}</fieldset><button type="button">Lưu tự đánh giá</button><output aria-live="polite"></output>`;
    container.append(section);
    const input=section.querySelector('textarea'),save=section.querySelector('button'),status=section.querySelector('output');
    let pending=null;
    apiFetch('/api/progress').then(r=>r.ok?r.json():null).then(data=>{const saved=data?.items?.find(r=>r.item_id===item.id);if(saved?.response_text && !input.value){input.value=saved.response_text;status.textContent='Đã khôi phục bài viết đã lưu.';}}).catch(()=>{status.textContent='Chưa tải được bài viết cũ.';});
    save.onclick=async()=>{
      if(input.value.trim().length<8){status.textContent='Hãy viết câu trả lời trước khi tự đánh giá.';input.focus();return;}
      if(!pending)pending={id:crypto.randomUUID(),text:input.value.trim(),correct:[...section.querySelectorAll('input')].every(c=>c.checked)};
      save.disabled=true;input.disabled=true;section.querySelectorAll('input').forEach(c=>c.disabled=true);
      try{await record(item.id,pending.correct,task.prompt,pending.id,pending.text);status.textContent=pending.correct?'Đã lưu: em tự đánh giá đạt tiêu chí.':'Đã lưu: cần ôn lại các tiêu chí chưa đạt.';pending=null;save.textContent='Lưu tự đánh giá';input.disabled=false;section.querySelectorAll('input').forEach(c=>c.disabled=false);}
      catch{status.textContent='Chưa lưu được. Bấm Lưu lại để gửi đúng bài vừa viết.';save.textContent='Lưu lại';}
      finally{save.disabled=false;}
    };
  }
  if(item.dictation) {
    for(const [index,example] of (item.examples||[]).entries()) {
      const section=document.createElement('section');section.className='lesson-exercise';
      const play=document.createElement('button');play.textContent=`Nghe câu ${index+1}`;play.onclick=()=>playGeminiTTS(example.jp);
      const input=document.createElement('textarea');input.setAttribute('aria-label',`Chép câu ${index+1} bằng tiếng Nhật`);input.rows=2;
      const reveal=document.createElement('button');reveal.textContent='Đối chiếu bản chép';
      const answer=document.createElement('div');answer.hidden=true;
      answer.innerHTML=`<p lang="ja">${furiganaHtml(example.furigana || example.jp)}</p><p>${escapeHtml(example.vi)}</p><a href="${escapeHtml(example.source)}" target="_blank" rel="noopener">Tatoeba ↗</a>`;
      const status=document.createElement('output');status.setAttribute('aria-live','polite');
      const attemptId=crypto.randomUUID();
      for(const [label,correct] of [['Đã hiểu',true],['Cần ôn lại',false]]){
        const grade=document.createElement('button');grade.textContent=label;
        grade.onclick=async()=>{answer.querySelectorAll('button').forEach(b=>b.disabled=true);try{await record(`${item.id}:${index}`,correct,example.jp,attemptId);status.textContent='Đã lưu.';}catch{status.textContent='Chưa lưu được. Thử lại.';answer.querySelectorAll('button').forEach(b=>b.disabled=false);}};answer.append(grade);
      }
      reveal.onclick=()=>{answer.hidden=false;};section.append(play,input,reveal,answer,status);container.append(section);
    }
  }
  if(item.script_jp){const listen=document.createElement('button');listen.className='stage-btn';listen.textContent='Nghe bài đọc';listen.onclick=()=>playGeminiTTS(item.script_jp);container.append(listen);}
  if(!questions.length)return;
  renderPracticeSession(container,item,level,skill,record);
}

function audioDataUrl(data) {
  if(!data.mimeType?.startsWith('audio/L16')) return `data:${data.mimeType || 'audio/wav'};base64,${data.audioBase64}`;
  const pcm=Uint8Array.from(atob(data.audioBase64),c=>c.charCodeAt(0));
  const wav=new Uint8Array(44+pcm.length),view=new DataView(wav.buffer);
  const write=(offset,text)=>[...text].forEach((c,i)=>wav[offset+i]=c.charCodeAt(0));
  write(0,'RIFF');view.setUint32(4,36+pcm.length,true);write(8,'WAVE');write(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,24000,true);view.setUint32(28,48000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);write(36,'data');view.setUint32(40,pcm.length,true);wav.set(pcm,44);
  let binary='';for(let i=0;i<wav.length;i+=8192) binary+=String.fromCharCode(...wav.subarray(i,i+8192));
  return 'data:audio/wav;base64,'+btoa(binary);
}

function buildLessonContext(item,level,skill){
  return {id:activityId(item,level,skill),title:item.roleplay?`${item.roleplay.title} · ${item.title}`:item.title || item.jp || 'Bài học',level,goal:item.roleplay?.goal || item.summary || item.meaning_vi || '',content:JSON.stringify({formula:item.formula,explanation:item.explanation,passage:item.passage,translation:item.translation,script_jp:item.script_jp,script_vi:item.script_vi,examples:item.examples?.slice(0,3),words:item.items?.slice(0,5),task:item.production,external_resources:item.externalResources}).slice(0,3500)};
}
