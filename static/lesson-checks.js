// Normalize source tasks once for lessons, exams and the server catalog. Never repair source keys here.
const taskQuarantines={
  'N4:1:3':'Four supplied parts, but the explanation uses three; the star position disagrees with the selected part.',
  'N3:1:3':'The explanation introduces unsupplied わかる as a fifth piece; supplied parts and options disagree.',
  'N3:2:3':'The explanation puts 私は third, but the stored key selects fourth-piece 決して.',
  'N2:1:3':'The named 〜にほかならない construction disagrees with the supplied 結晶にほかにならない assembly.',
  'N2:2:3':'The explanation puts 従わ third, but the stored key selects fourth-piece ざる.',
  // Review candidates are unavailable, not silently promoted to corrected keys.
  'N1:1:3':'Language review pending: the proposed sequence joins ある to 極まりない without an established construction.',
  'N4:1:2':'Unique answer not established: both おくれて and とまって fit the supplied accident context.',
  'N5:1:5':'Unique star position not established: the supplied destination, companion and transport phrases permit another order.',
  'N5:2:3':'Unique star position not established: たくさん may precede the object, changing the star choice.',
  'N4:2:3':'Unique star position not established: 心を込めて may precede the material phrase, changing the star choice.'
};
function taskRevisionSource(task){
  const fields=['task-v1',task.task_id,task.item_id,task.mode,task.q,task.instruction||'',task.passage||'',task.script_jp||'',task.target||'',task.parts||[],task.opts||[],task.answer_index??null,task.accepted_answers||[],task.explanation||'',task.review_status,task.unavailable_reason||'',task.criteria||[],task.model||'',task.skill||'',task.source_language||''];
  if(task.objective!==undefined || task.exchange)fields.push('assessment-v1',task.objective || '',task.exchange || null);
  if(task.localization || task.option_sources)fields.push('localization-v1',task.localization || [],task.option_sources || []);
  return JSON.stringify(fields);
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
    const exchange=source.exchange && typeof source.exchange==='object' && !Array.isArray(source.exchange)?{
      group:source.exchange.group,stage:source.exchange.stage,prior_task_ids:Array.isArray(source.exchange.prior_task_ids)?[...source.exchange.prior_task_ids]:[],
      ...(source.exchange.partner_reply?{partner_reply:source.exchange.partner_reply}:{}),
      ...(source.exchange.delay_hours!==undefined?{delay_hours:source.exchange.delay_hours}:{})
    }:null;
    const quarantine=taskQuarantines[source.source_identity];
    let unavailable_reason=quarantine || source.unavailable_reason || '';
    const task={
      q:typeof source.q==='string'?source.q:'',instruction:source.instruction || '',
      passage:source.passage ?? item.passage ?? dialogue,
      script_jp:source.script_jp ?? item.script_jp ?? '',
      target:source.target || '',parts:Array.isArray(source.parts)?[...source.parts]:[],
      opts,answer_index:mode==='choice'?answer_index:null,accepted_answers,
      item_id:source.item_id || `${id}:${index}`,
      task_id:source.task_key || `${canonicalId}:question:${key}`,source_position:index,mode,
      skill:source.skill || skill,review_status:quarantine?'quarantined':'unreviewed',
      explanation:source.explanation || source.explain || '',
      example_indexes:Array.isArray(source.example_indexes)?[...source.example_indexes]:[],
      source_language:source.source_language || item.language || 'vi',
      ...(source.source_identity?{source_identity:source.source_identity}:{}),
      ...(source.option_sources?{option_sources:[...source.option_sources]}:{}),
      ...(source.localization?{localization:source.localization.map(entry=>({...entry}))}:{}),
      ...(source.criteria?{criteria:[...source.criteria]}:{}),
      ...(source.model?{model:source.model}:{}),
      ...(source.objective!==undefined?{objective:source.objective}:{}),
      ...(exchange?{exchange}:{})
    };
    if(!unavailable_reason){
      if(!['choice','recall','dictation','writing'].includes(mode))unavailable_reason='Unsupported task mode.';
      else if(!task.q.trim())unavailable_reason='Missing source task text.';
      else if(mode==='choice' && (opts.length<2 || opts.some(option=>typeof option!=='string' || !option.trim()) || !Number.isInteger(answer_index) || answer_index<0 || answer_index>=opts.length))unavailable_reason='Missing or ambiguous source answer position/options.';
      else if(['recall','dictation'].includes(mode) && (!accepted_answers.length || accepted_answers.some(answer=>typeof answer!=='string' || !answer.trim())))unavailable_reason='Missing explicit source text answer.';
      else if(source.requires_passage && (typeof task.passage!=='string' || !task.passage.trim()))unavailable_reason='Missing required source passage/dialogue.';
      else if(source.requires_script && (typeof task.script_jp!=='string' || !task.script_jp.trim()))unavailable_reason='Missing required source listening context.';
      else if(source.objective!==undefined && !['meaning','structure','orthography','transformation','communication'].includes(source.objective))unavailable_reason='Missing supported assessment objective.';
      else if(source.exchange && (!exchange || mode!=='writing' || typeof exchange.group!=='string' || !exchange.group
        || !['invite','accept','refuse','produce','respond','revise','delayed'].includes(exchange.stage)
        || !Array.isArray(source.exchange.prior_task_ids) || exchange.prior_task_ids.length>8
        || exchange.prior_task_ids.some(id=>typeof id!=='string' || !id) || new Set(exchange.prior_task_ids).size!==exchange.prior_task_ids.length
        || ['invite','produce'].includes(exchange.stage)!==(exchange.prior_task_ids.length===0)
        || exchange.partner_reply!==undefined && typeof exchange.partner_reply!=='string'
        || exchange.stage==='delayed' && exchange.delay_hours!==24
        || exchange.stage!=='delayed' && exchange.delay_hours!==undefined))unavailable_reason='Invalid source exchange context.';
    }
    if(item.processing_allowed===false || source.processing_allowed===false || item.capabilities?.processing===false || source.capabilities?.processing===false)unavailable_reason ||= 'Source permissions prohibit provider processing.';
    task.unavailable_reason=unavailable_reason;
    task.capabilities={answer:!unavailable_reason,hint:!unavailable_reason,evaluation:!unavailable_reason,processing:!unavailable_reason};
    tasks.push(task);
  };
  if(item.production){
    const production=item.production;
    const limitation=id==='practical:v1:N2:policy:production'
      ?'Bài mẫu nguồn chỉ ghi 来月から, chưa giữ chính xác ngày 来月一日から. Không dùng mẫu ấy làm câu trả lời đầy đủ; hãy tự giữ nguyên ngày hiệu lực và các điều kiện trong thông báo.':'';
    add({mode:'writing',q:production.prompt,instruction:production.instruction || '',item_id:id,criteria:production.criteria || [],
      model:limitation?'':production.model,explanation:limitation},0);
    return tasks;
  }
  if(item.dictation){
    for(const [index,example] of (item.examples || []).entries())add({
      mode:'dictation',q:`Nghe và chép câu ${index+1} bằng tiếng Nhật.`,
      instruction:'',item_id:`${id}:${index}`,
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
      const format=/[A-Za-z]/.test(reading)?'chữ Latin (romaji)':/^[ぁ-ゖー・\s]+$/.test(reading)?'hiragana':/^[ァ-ヺー・\s]+$/.test(reading)?'katakana':/^[ぁ-ゖァ-ヺー・\s]+$/.test(reading)?'kana':'cách ghi trong bài';
      add({mode:'recall',q:`Em ghi lại cách đọc của ${word.jp} bằng ${format} nhé.`,instruction:'',
        accepted_answers:[reading],item_id:`${id}:${key}`,source_identity:word.id,skill,passage:'',script_jp:''},tasks.length,key);
    }
    if(!item.editorial && skill==='grammar' && item.formula && !tasks.some(task=>task.mode==='recall')){
      const key='recall:formation';
      add({mode:'recall',q:`Em ghi lại công thức của mẫu ${item.title} nhé.`,instruction:'Giữ nguyên các dấu +, /, | và dấu ngoặc trong công thức.',
        accepted_answers:[item.formula],item_id:`${id}:${key}`,skill,passage:'',script_jp:''},tasks.length,key);
    }
  }
  return tasks;
}
