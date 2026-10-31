const bookPicker=document.getElementById('source-book');
const sourceSearch=document.getElementById('source-search');
const sourceList=document.getElementById('source-list');
const sourceCount=document.getElementById('source-count');
const sourceRetry=document.getElementById('source-retry');
let sourceLessons=[];
function renderSources(){
  const query=sourceSearch.value.trim().toLocaleLowerCase();
  const lessons=sourceLessons.filter(l=>l.book===bookPicker.value && `${l.number} ${l.title}`.toLocaleLowerCase().includes(query));
  sourceList.replaceChildren();
  sourceCount.textContent=lessons.length?`${lessons.length} bài`:'Không tìm thấy bài. Thử tên hoặc số bài khác.';
  for(const lesson of lessons){
    const row=document.createElement('article');row.className='source-row';
    const title=document.createElement('h3');title.textContent=lesson.title;
    const links=document.createElement('div');
    for(const [label,url] of [['PDF ↗',lesson.pdf_url],['Bản nghe ↗',lesson.audio_page_url]]){
      if(!url)continue;
      const link=document.createElement('a');link.textContent=label;link.href=url;link.target='_blank';link.rel='noopener';link.setAttribute('aria-label',`${label} · ${lesson.title}`);links.append(link);
    }
    row.append(title,links);sourceList.append(row);
  }
}
async function loadSources(){
  sourceRetry.hidden=true;sourceCount.textContent='Đang tải tài liệu…';
  try{
    const response=await fetch('course/sources.json');if(!response.ok)throw new Error('sources');
    const data=await response.json();sourceLessons=data.lessons;
    document.getElementById('source-date').textContent=`Cập nhật nguồn: ${new Date(data.retrieved_at).toLocaleDateString('vi-VN')} · ${sourceLessons.length} bài trong 4 quyển.`;
    renderSources();
  }catch{sourceCount.textContent='Chưa tải được danh mục tài liệu.';sourceRetry.hidden=false;}
}
bookPicker.onchange=renderSources;sourceSearch.oninput=renderSources;sourceRetry.onclick=loadSources;
loadSources();
