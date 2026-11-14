// Vietnamese labels for the English OpenJLPT data. Anything without a Vietnamese entry stays as published.
const VI_PARENS = {reason: 'lý do', hearsay: 'nghe nói', purpose: 'mục đích', subject: 'chủ ngữ', time: 'thời gian', destination: 'đích đến', 'place of existence': 'nơi tồn tại', 'indirect object': 'tân ngữ gián tiếp', frequency: 'tần suất', 'place of action': 'nơi diễn ra hành động', means: 'phương tiện', and: 'và', with: 'cùng', or: 'hoặc', possessive: 'sở hữu', from: 'từ', until: 'cho đến', question: 'nghi vấn', while: 'trong khi', but: 'nhưng', decide: 'quyết định', approximately: 'khoảng', 'na-adjective': 'tính từ な', named: 'tên là', appearance: 'vẻ ngoài', 'hearsay/conjecture': 'nghe nói/phỏng đoán', potential: 'khả năng', passive: 'bị động', prohibition: 'cấm', conditional: 'điều kiện', although: 'mặc dù', 'embedded question': 'câu hỏi lồng', emphasis: 'nhấn mạnh', nominalizer: 'danh từ hóa', suggestion: 'đề nghị', make: 'khiến', instruction: 'chỉ thị', 'typical of': 'điển hình của', like: 'giống như', extent: 'mức độ', even: 'ngay cả'};
const VI_FORMULA_COMPOUNDS = {'potential of the same verb': 'thể khả năng của cùng động từ', 'Question word': 'Từ để hỏi'};
const VI_FORMULA = {'Verb-volitional': 'Động từ thể ý chí', 'Verb-plain': 'Động từ thể thường', 'Verb-dict': 'Động từ thể từ điển', 'Verb-stem': 'Động từ thân ます', 'Verb-nai': 'Động từ thể ない', 'Verb-te': 'Động từ thể て', 'Verb-ta': 'Động từ thể た', 'Verb-ba': 'Động từ thể ば', 'i-Adj-ku': 'Tính từ い (bỏ い + く)', 'i-Adj': 'Tính từ い', 'na-Adj': 'Tính từ な', 'potential form': 'thể khả năng', 'short form': 'thể ngắn', Noun: 'Danh từ', Sentence: 'Câu', Question: 'Từ để hỏi', Group: 'Nhóm', counter: 'lượng từ', number: 'số', quantity: 'số lượng', particle: 'trợ từ', verbs: 'động từ', verb: 'động từ', stem: 'thân từ', word: 'từ', giver: 'người cho', receiver: 'người nhận', plain: 'thể thường', ichidan: 'nhóm II', potential: 'khả năng', final: 'cuối', same: 'cùng'};
const VI_FORMULA_RE = new RegExp('(?<![A-Za-z-])(' + Object.keys(VI_FORMULA).sort((a, b) => b.length - a.length).map(k => k.replace(/[-/]/g, '\\$&')).join('|') + ')(?![A-Za-z-])', 'g');
const viPatternLabel = pattern => String(pattern).replace(/([（(])([A-Za-z][^）)]*)([）)])/g, (all, open, text, close) => VI_PARENS[text] ? open + VI_PARENS[text] + close : all);
const viFormulaLabel = value => String(value ?? '')
  .replaceAll('Động từ thân ます','Động từ thể ます (bỏ ます)')
  .replaceAll('Động từ thể ない thân từ','Động từ thể ない (bỏ ない)')
  .replaceAll('Tính từ い thân từ','Tính từ い (bỏ い)');
// Long compounds are translated before individual tokens; displayed and accepted formulas agree.
const viFormula = formula => viFormulaLabel(Object.entries(VI_FORMULA_COMPOUNDS).reduce((text,[from,to])=>text.replaceAll(from,to),String(formula ?? '')).replace(VI_FORMULA_RE,word=>VI_FORMULA[word]));
let viDictLoad,viContextLoad;
async function viJson(name){
  const response=await fetch(`course/${name}.json`);
  if(!response.ok)throw new Error('Chưa tải được phần tiếng Việt. Em thử lại nhé.');
  const value=await response.json();
  if(!value || typeof value!=='object' || Array.isArray(value))throw new Error('Phần tiếng Việt đang có lỗi. Em thử lại nhé.');
  return value;
}
function loadViDict(){
  // Preserve all existing grammar entries; the imported corpus is a draft, not semantic approval.
  if(!viDictLoad)viDictLoad=Promise.all(['vi-dict','vi-grammar'].map(viJson)).then(parts=>{
    if(parts.some(part=>Object.values(part).some(value=>typeof value!=='string' || !value.trim())))throw new Error('Phần tiếng Việt đang có lỗi. Em thử lại nhé.');
    return Object.assign({},...parts);
  }).catch(error=>{viDictLoad=null;throw error;});
  return viDictLoad;
}
function loadViContext(){
  if(!viContextLoad)viContextLoad=viJson('vi-context').then(value=>{
    // Version 1 is the complete 64-field bound review inventory; partial downloads must not unlock entries.
    if(value.version!==1 || !Array.isArray(value.entries) || value.entries.length!==64
      || value.entries.some(entry=>!/^openjlpt:N[1-5]:(?:vocabulary|grammar|kanji):[^:]+$/.test(entry.source_identity)
        || !/^(?:meanings\[\d+\]|examples\[\d+\]\.en|meaning|notes)$/.test(entry.field) || typeof entry.japanese!=='string'
        || typeof entry.english!=='string' || !['contextual','unavailable'].includes(entry.disposition)
        || typeof entry.why!=='string' || !entry.why || typeof entry.text!=='string' || !entry.text)
      || new Set(value.entries.map(entry=>JSON.stringify([entry.source_identity,entry.field]))).size!==value.entries.length)
      throw new Error('Phần nghĩa theo ngữ cảnh đang có lỗi. Em thử lại nhé.');
    // Pin the complete required identity/field set, independently of row count or JSON order.
    const keys=value.entries.map(entry=>JSON.stringify([entry.source_identity,entry.field])).sort().join('\n');
    let fingerprint=2166136261;
    for(let index=0;index<keys.length;index++){fingerprint^=keys.charCodeAt(index);fingerprint=Math.imul(fingerprint,16777619)>>>0;}
    if(keys.length!==3222 || fingerprint!==1279807004)throw new Error('Phần nghĩa theo ngữ cảnh đang có lỗi. Em thử lại nhé.');
    return new Map(value.entries.map(entry=>[JSON.stringify([entry.source_identity,entry.field]),entry]));
  }).catch(error=>{viContextLoad=null;throw error;});
  return viContextLoad;
}
function viText({source_identity,field,japanese,english},dict,context){
  const entry=context.get(JSON.stringify([source_identity,field]));
  const changed=entry && (entry.japanese!==japanese || entry.english!==english);
  const unavailable=changed || entry?.disposition==='unavailable';
  // Full source bindings and review reasons live once in vi-context.json, never in every task copy.
  const localization=entry?{source_identity,field,disposition:unavailable?'unavailable':entry.disposition}:undefined;
  return {text:unavailable?'Nghĩa đang được kiểm tra lại.':entry?.text || dict[english] || english,
    ...(localization?{localization}:{}),
    ...(unavailable?{unavailable_reason:'Nghĩa của mục này đang được kiểm tra lại.',processing_allowed:false}:{})};
}
function viResource(resource,dict){
  const sourceTitle=resource.sourceTitle || resource.title;
  return {...resource,sourceTitle,title:dict[sourceTitle] || sourceTitle};
}
