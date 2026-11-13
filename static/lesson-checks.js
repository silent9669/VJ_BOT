// Normalize source tasks once for lessons, exams and the server catalog. Never repair source keys here.
const taskQuarantines={
  'N4:1:3':'Four supplied parts, but the explanation uses three; the star position disagrees with the selected part.',
  'N3:1:3':'The explanation introduces unsupplied わかる as a fifth piece; supplied parts and options disagree.',
  'N3:2:3':'The explanation puts 私は third, but the stored key selects fourth-piece 決して.',
  'N2:1:3':'The named 〜にほかならない construction disagrees with the supplied 結晶にほかにならない assembly.',
  'N2:2:3':'The explanation puts 従わ third, but the stored key selects fourth-piece ざる.'
};
function taskRevisionSource(task){
  return JSON.stringify(['task-v1',task.task_id,task.item_id,task.mode,task.q,task.instruction||'',task.passage||'',task.script_jp||'',task.target||'',task.parts||[],task.opts||[],task.answer_index??null,task.accepted_answers||[],task.explanation||'',task.review_status,task.unavailable_reason||'',task.criteria||[],task.model||'',task.skill||'',task.source_language||'']);
}
function normalizedLessonTasks(item,level,skill){
  if(item.externalResources)return [];
  const id=item.id || `lesson:${level}:${skill}:${item.lesson}`;
  const canonicalId=item.completionId || id;
  const dialogue=item.roleplay?.dialogue?.map(line=>line.jp).filter(Boolean).join('\n') || '';
  const tasks=[];
  const add=(source,index,key=index)=>{
    source=source && typeof source==='object'?source:{};
    const mode=source.mode || 'choice';
    const opts=Array.isArray(source.opts)?[...source.opts]:[];
    let answer_index=null;
    if(mode==='choice'){
      if(Object.hasOwn(source,'answer_index'))answer_index=source.answer_index ?? null;
      else if(Number.isInteger(source.answer))answer_index=source.answer;
      else if(typeof source.ans==='string' && opts.filter(option=>option===source.ans).length===1)answer_index=opts.indexOf(source.ans);
    }
    const accepted_answers=Array.isArray(source.accepted_answers)?[...source.accepted_answers]:[];
    const quarantine=taskQuarantines[source.source_identity];
    let unavailable_reason=quarantine || source.unavailable_reason || '';
    const task={
      q:typeof source.q==='string'?source.q:'',instruction:source.instruction || '',
      passage:source.passage ?? item.passage ?? dialogue,
      script_jp:source.script_jp ?? item.script_jp ?? '',
      target:source.target || '',parts:Array.isArray(source.parts)?[...source.parts]:[],
      opts,answer_index:mode==='choice'?answer_index:null,accepted_answers,
      item_id:source.item_id || `${id}:${index}`,
      task_id:`${canonicalId}:question:${key}`,source_position:index,mode,
      skill:source.skill || skill,review_status:quarantine?'quarantined':'unreviewed',
      explanation:source.explanation || source.explain || '',
      example_indexes:Array.isArray(source.example_indexes)?[...source.example_indexes]:[],
      source_language:source.source_language || item.language || 'vi',
      ...(source.source_identity?{source_identity:source.source_identity}:{}),
      ...(source.criteria?{criteria:[...source.criteria]}:{}),
      ...(source.model?{model:source.model}:{})
    };
    if(!unavailable_reason){
      if(!['choice','recall','dictation','writing'].includes(mode))unavailable_reason='Unsupported task mode.';
      else if(!task.q.trim())unavailable_reason='Missing source task text.';
      else if(mode==='choice' && (opts.length<2 || opts.some(option=>typeof option!=='string' || !option.trim()) || !Number.isInteger(answer_index) || answer_index<0 || answer_index>=opts.length))unavailable_reason='Missing or ambiguous source answer position/options.';
      else if(['recall','dictation'].includes(mode) && (!accepted_answers.length || accepted_answers.some(answer=>typeof answer!=='string' || !answer.trim())))unavailable_reason='Missing explicit source text answer.';
      else if(source.requires_passage && (typeof task.passage!=='string' || !task.passage.trim()))unavailable_reason='Missing required source passage/dialogue.';
      else if(source.requires_script && (typeof task.script_jp!=='string' || !task.script_jp.trim()))unavailable_reason='Missing required source listening context.';
    }
    if(item.processing_allowed===false || source.processing_allowed===false || item.capabilities?.processing===false || source.capabilities?.processing===false)unavailable_reason ||= 'Source permissions prohibit provider processing.';
    task.unavailable_reason=unavailable_reason;
    task.capabilities={answer:!unavailable_reason,hint:!unavailable_reason,evaluation:!unavailable_reason,processing:!unavailable_reason};
    tasks.push(task);
  };
  if(item.production){
    const production=item.production;
    add({mode:'writing',q:production.prompt,instruction:production.question_jp,item_id:id,criteria:production.criteria || [],model:production.model},0);
    return tasks;
  }
  if(item.dictation){
    for(const [index,example] of (item.examples || []).entries())add({
      mode:'dictation',q:`Nghe và chép câu ${index+1} bằng tiếng Nhật.`,
      instruction:'Nghe câu trước khi đối chiếu bản chép nguồn.',item_id:`${id}:${index}`,
      accepted_answers:example.jp?[example.jp]:[],example_indexes:[index],
      // Transcript is reveal-only; never put it in the pre-answer stimulus.
      passage:'',script_jp:''
    },index);
    return tasks;
  }
  const sources=item.drills || item.questions || (item.q?[item]:[]);
  for(const [index,source] of sources.entries())add(source,index);
  // Extra directions have semantic IDs, not the retired fixed-five filler identities.
  if(!Number.isInteger(item.examIndex)){
    if(['kana','vocabulary'].includes(skill))for(const word of (item.items || item.roleplay?.words || [])){
      const reading=word.reading || word.ro;
      if(!word.jp || !reading)continue;
      const key=`recall:reading:${word.id || word.jp}`;
      add({mode:'recall',q:`Tự viết cách đọc của ${word.jp}.`,instruction:skill==='kana' || !word.reading?'Viết cách đọc bằng romaji theo nguồn.':'Viết cách đọc bằng kana theo nguồn.',
        accepted_answers:[reading],item_id:`${id}:${key}`,skill,passage:'',script_jp:''},tasks.length,key);
    }
    if(skill==='grammar' && item.formula){
      const key='recall:formation';
      add({mode:'recall',q:`Viết lại cấu trúc nguồn của mẫu ${item.title}.`,instruction:'Nhớ lại cấu trúc đã học; đối chiếu theo đúng ký hiệu của nguồn.',
        accepted_answers:[item.formula],item_id:`${id}:${key}`,skill,passage:'',script_jp:''},tasks.length,key);
    }
  }
  return tasks;
}
