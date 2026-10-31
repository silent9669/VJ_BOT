// Five source-based questions per in-app lesson. External document links are not quizzes.
function fiveLessonQuestions(item,level,skill){
  if(item.externalResources)return [];
  const id=item.id || `lesson:${level}:${skill}:${item.lesson}`;
  const questions=[],seen=new Set();
  const add=(q,ans,options,key,original={})=>{
    if(!q || !ans || seen.has(q))return;
    const wrong=[...new Set(options.filter(x=>typeof x==='string' && x.trim() && x!==ans))].slice(0,3);
    if(!wrong.length)return;
    const opts=[...wrong];opts.splice(questions.length%(wrong.length+1),0,ans);
    questions.push({...original,q,ans,opts,item_id:original.item_id || `${id}:check:${key}`,skill});seen.add(q);
  };
  for(const [i,q] of (item.drills || item.questions || (item.q?[item]:[])).entries())add(q.q,q.ans,q.opts || [],`source-${i}`,{...q,item_id:q.item_id || `${id}:${i}`});
  if(questions.length>=5)return questions.slice(0,5);
  const skills=window.JLPT_DATA.curriculum[level].skills;
  const words=item.items || item.roleplay?.words || item.targetWords || [];
  const poolWords=[...words,...(skills[skill]||[]).flatMap(l=>l.items||[]),...skills.vocabulary.flatMap(l=>l.items||[])];
  for(const [i,w] of words.entries()){
    add(`${w.jp} — nghĩa nào phù hợp?`,w.vi || w.meaning_vi,poolWords.map(v=>v.vi || v.meaning_vi),`meaning-${i}`);
    add(`Chọn cách đọc của ${w.jp}.`,w.reading || w.ro,poolWords.map(v=>v.reading || v.ro),`reading-${i}`);
    add(`Chọn chữ cho cách đọc “${w.reading || w.ro}”.`,w.jp,poolWords.map(v=>v.jp),`character-${i}`);
  }
  const grammar=skills.grammar || [];
  if(item.meaning_vi && !questions.some(q=>q.ans===item.meaning_vi)){add(`Mẫu ${item.title} diễn đạt ý nào?`,item.meaning_vi,grammar.map(g=>g.meaning_vi),'meaning');}
  if(item.formula){add(`Cấu trúc nào dùng với ${item.title}?`,item.formula,grammar.map(g=>g.formula),'formation');}
  const examples=item.examples || item.roleplay?.dialogue || [];
  const examplePool=[...examples,...(skills[skill]||[]).flatMap(l=>l.examples||[]),...grammar.flatMap(g=>g.examples||[])];
  for(const [i,e] of examples.entries()){
    add(`Chọn nghĩa của câu: ${e.jp}`,e.vi,examplePool.map(x=>x.vi),`example-${i}`);
    if(e.ro)add(`Chọn cách đọc của câu: ${e.jp}`,e.ro,examplePool.map(x=>x.ro),'romaji-'+i);
    add(`Câu nào diễn đạt: “${e.vi}”?`,e.jp,examplePool.map(x=>x.jp),`sentence-${i}`);
  }
  // The smallest kana group still supports an ordering question after both reading directions.
  if(words.length>=2)add(`Chọn cách đọc theo thứ tự: ${words.slice(0,2).map(w=>w.jp).join(' → ')}`,words.slice(0,2).map(w=>w.reading || w.ro).join(' → '),[words.slice(0,2).reverse().map(w=>w.reading || w.ro).join(' → ')],'order');
  return questions.slice(0,5);
}
