const bookPicker=document.getElementById('source-book');
const sourceSearch=document.getElementById('source-search');
const sourceList=document.getElementById('source-list');
const sourceCount=document.getElementById('source-count');
const sourceRetry=document.getElementById('source-retry');
let sourceLessons=[];
function renderSources(){
  const query=sourceSearch.value.trim().toLocaleLowerCase();
  const lessons=sourceLessons.filter(l=>l.book===bookPicker.value && `${l.number} ${l.title} ${l.sourceTitle || ''}`.toLocaleLowerCase().includes(query));
  sourceList.replaceChildren();
  sourceCount.textContent=lessons.length?`${lessons.length} bài`:'Không tìm thấy bài. Thử tên hoặc số bài khác.';
  for(const lesson of lessons){
    const row=document.createElement('details');row.className='source-row';
    const title=document.createElement('summary');title.textContent=lesson.title;
    const links=document.createElement('div');
    for(const [label,url] of (lesson.resources?lesson.resources.map(r=>[r.title+' ↗',r.url]):[['PDF ↗',lesson.pdf_url],['Bản nghe ↗',lesson.audio_page_url]])){
      if(!url)continue;
      const link=document.createElement('a');link.textContent=label;link.href=url;link.target='_blank';link.rel='noopener';link.setAttribute('aria-label',`${label} · ${lesson.title}`);links.append(link);
    }
    row.append(title,links);sourceList.append(row);
    row.addEventListener('toggle',()=>{if(row.open)for(const other of sourceList.children)if(other!==row)other.open=false;});
  }
}
async function loadSources(){
  sourceRetry.hidden=true;sourceCount.textContent='Đang tải tài liệu…';
  try{
    const [data,erin,jlpt,dict]=await Promise.all([...['sources','erin-resources','jlpt-resources'].map(async name=>{const response=await fetch(`course/${name}.json`);if(!response.ok)throw new Error('sources');return response.json();}),loadViDict()]);sourceLessons=[...data.lessons,...erin.lessons,...['2018','2012'].flatMap(year=>['N5','N4','N3','N2','N1'].map(level=>({book:`jlpt-${year}`,title:`JLPT ${level} · ${year}`,number:level,resources:jlpt.resources.filter(r=>r.year===year && r.level===level)})))].map(lesson=>({...lesson,sourceTitle:lesson.title,title:dict[lesson.title] || lesson.title}));
    document.getElementById('source-date').textContent=`Cập nhật nguồn: ${new Date(data.retrieved_at).toLocaleDateString('vi-VN')} · ${data.lessons.length} bài Irodori · ${erin.lessons.length} bài Erin · ${jlpt.resources.length} tài liệu JLPT.`;
    renderSources();
  }catch{sourceCount.textContent='Chưa tải được danh mục tài liệu.';sourceRetry.hidden=false;}
}
bookPicker.onchange=renderSources;sourceSearch.oninput=renderSources;sourceRetry.onclick=loadSources;
loadSources();

const learningSourceList=document.getElementById('learning-source-list');
const learningSourceCount=document.getElementById('learning-source-count');
const learningSourceRetry=document.getElementById('learning-source-retry');
const learningSourceHosts={
  naoki:['www.naoki.edu.vn'],freetag:['freetag.jp'],saromalang:['www.saromalang.com'],
  mokumoku:['mokumoku.vn'],tiengnhatdongian:['www.tiengnhatdongian.com'],
  nhk:['www.nhk.or.jp','www3.nhk.or.jp'],irodori:['www.irodori.jpf.go.jp','hn.jpf.go.jp','jf.xcms.online']
};
const learningSourcePermissions={
  permission_required:'Cần xác nhận quyền tái sử dụng',unresolved:'Chưa xác minh quyền tái sử dụng',
  restricted:'Không thu thập nội dung tự động'
};
const learningSourceAccess={
  lesson_read:'Đã đọc bài mẫu',index_read:'Đã đọc trang danh mục',shell_only:'Chỉ đọc được phần giới thiệu'
};
function learningSourceLink(label,value,hosts){
  const url=new URL(value);
  if(url.protocol!=='https:' || !hosts.includes(url.hostname) || url.username || url.password || (url.port && url.port!=='443'))throw new Error('publisher link');
  const link=document.createElement('a');link.textContent=label;link.href=url.href;
  link.target='_blank';link.rel='noopener noreferrer';return link;
}
function renderLearningSources(data){
  if(!Array.isArray(data.sources) || data.sources.length!==7 || new Set(data.sources.map(source=>source.id)).size!==7)throw new Error('incomplete source catalog');
  const rows=[];
  for(const source of data.sources){
    const hosts=learningSourceHosts[source.id];
    if(!hosts || source.corpus_allowed!==false || !Object.hasOwn(learningSourcePermissions,source.permission_status) || !Object.hasOwn(learningSourceAccess,source.access_kind) || !source.links?.length || !source.policy_evidence?.length)throw new Error('unreviewed source catalog');
    const row=document.createElement('details');row.className='source-notes';
    const title=document.createElement('summary');title.textContent=source.name;
    const description=document.createElement('p');description.textContent=source.description_vi;
    const status=document.createElement('p');status.textContent=`${learningSourcePermissions[source.permission_status]} · ${learningSourceAccess[source.access_kind]}.`;
    const note=document.createElement('p');note.textContent=`Đánh giá điều khoản trước xác nhận của chủ ứng dụng: ${source.permission_note_vi}`;
    const links=document.createElement('ul');
    for(const item of source.links){
      const entry=document.createElement('li');entry.append(learningSourceLink(item.title,item.url,hosts));links.append(entry);
    }
    const policies=document.createElement('ul');
    source.policy_evidence.forEach((item,index)=>{
      const entry=document.createElement('li');entry.append(learningSourceLink(`Nguồn kiểm tra quyền ${index+1}`,item.url,hosts));policies.append(entry);
    });
    row.append(title,description,status,note,links,policies);rows.push(row);
  }
  learningSourceList.replaceChildren(...rows);
  learningSourceCount.textContent='7 nguồn đã khảo sát. Corpus bên dưới ghi riêng phạm vi thu thập và quyền do chủ ứng dụng xác nhận.';
}
async function loadLearningSources(){
  learningSourceRetry.hidden=true;learningSourceCount.textContent='Đang tải nguồn học Nhật–Việt…';
  try{
    const response=await fetch('course/learning-sources.json');
    if(!response.ok)throw new Error('source catalog unavailable');
    renderLearningSources(await response.json());
  }catch{
    learningSourceList.replaceChildren();
    learningSourceCount.textContent='Chưa tải được danh mục nguồn học Nhật–Việt. Danh mục học liệu chính thức vẫn hoạt động riêng.';
    learningSourceRetry.hidden=false;
  }
}
learningSourceRetry.onclick=loadLearningSources;
loadLearningSources();

const corpusSearch=document.getElementById('corpus-search');
const corpusList=document.getElementById('corpus-list');
const corpusCount=document.getElementById('corpus-count');
const corpusRetry=document.getElementById('corpus-retry');
let learningPassages=[];
function renderLearningPassages(){
  const query=corpusSearch.value.normalize('NFKC').toLowerCase().trim();
  const found=learningPassages.filter(passage=>`${passage.id} ${passage.source_name} ${passage.title} ${passage.text}`.normalize('NFKC').toLowerCase().includes(query));
  const rows=found.slice(0,20).map(passage=>{
    const row=document.createElement('details');row.className='source-notes';
    const title=document.createElement('summary');title.textContent=`Nguồn: ${passage.source_name} [${passage.id}] · ${passage.title}`;
    const link=learningSourceLink('Mở tài liệu gốc',passage.url,learningSourceHosts[passage.source_id]);
    const text=document.createElement('p');text.textContent=passage.text;
    row.append(title,link,text);return row;
  });
  corpusList.replaceChildren(...rows);
  corpusCount.textContent=`${found.length} đoạn khớp · hiển thị ${rows.length}. Mã nguồn ở đầu mỗi đoạn và câu trả lời RAG; nội dung chưa được duyệt sư phạm.`;
}
async function loadLearningCorpus(){
  corpusRetry.hidden=true;corpusCount.textContent='Đang tải kho ngữ liệu có ghi nguồn…';
  try{
    const response=await fetch('course/learning-corpus.json');
    if(!response.ok)throw new Error('corpus unavailable');
    const data=await response.json();
    if(data.version!==1 || data.authorization?.basis!=='user_asserted_rights' || !Array.isArray(data.chunks) || !data.chunks.length || data.chunks.length>1500)throw new Error('invalid corpus');
    const ids=new Set();
    for(const passage of data.chunks){
      const hosts=learningSourceHosts[passage.source_id];
      if(!hosts || passage.source_id==='nhk' || typeof passage.id!=='string' || !/^[A-Z]{2}-[a-f0-9]{12}-[1-9]\d*$/.test(passage.id)
        || ids.has(passage.id) || typeof passage.title!=='string' || typeof passage.source_name!=='string'
        || typeof passage.text!=='string' || passage.text.length>1400)throw new Error('invalid passage');
      learningSourceLink('',passage.url,hosts);ids.add(passage.id);
    }
    learningPassages=data.chunks;
    renderLearningPassages();
  }catch{
    learningPassages=[];corpusList.replaceChildren();
    corpusCount.textContent='Chưa tải được kho ngữ liệu RAG. Không coi lỗi tải là kho ngữ liệu rỗng; danh mục liên kết vẫn hoạt động riêng.';
    corpusRetry.hidden=false;
  }
}
corpusSearch.oninput=renderLearningPassages;
corpusRetry.onclick=loadLearningCorpus;
loadLearningCorpus();
