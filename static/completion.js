let completionRecords=new Map(),completionVersion=0;
async function loadCompletions(){
  const version=completionVersion;
  const response=await apiFetch('/api/completions');
  if(!response.ok)throw new Error('completion');
  const data=await response.json();if(version!==completionVersion)return completionRecords;completionRecords=new Map(data.items.map(x=>[x.activity_id,x]));return completionRecords;
}
function activityId(item,level,skill){return item.id || `lesson:${level}:${skill}:${item.lesson}`;}
function mountCompletion(host,activity,loaded=false){
  host.replaceChildren();host.classList.add('completion-control');
  const button=document.createElement('button'),status=document.createElement('output');button.type='button';status.setAttribute('aria-live','polite');
  const draw=()=>{const done=completionRecords.has(activity.activity_id);button.textContent=done?'Đã hoàn thành · Bỏ đánh dấu':'Đánh dấu hoàn thành';button.setAttribute('aria-pressed',String(done));};
  draw();button.disabled=true;host.append(button,status);
  async function refresh(){
    try{await loadCompletions();draw();button.disabled=false;status.textContent='';}
    catch{status.textContent='Chưa tải được trạng thái. ';const retry=document.createElement('button');retry.textContent='Thử lại';retry.onclick=refresh;status.append(retry);}
  }
  if(loaded)button.disabled=false;else refresh();
  let pending=null;
  button.onclick=async()=>{
    if(pending===null)pending=!completionRecords.has(activity.activity_id);
    button.disabled=true;
    try{
      const response=await apiFetch('/api/completions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...activity,completed:pending})});
      if(!response.ok)throw new Error('save');
      completionVersion++;
      if(pending)completionRecords.set(activity.activity_id,activity);else completionRecords.delete(activity.activity_id);
      pending=null;draw();status.textContent='Đã lưu.';window.dispatchEvent(new CustomEvent('completion-changed'));
    }catch{status.textContent='Chưa lưu được. Bấm lại để thử lại.';}
    finally{button.disabled=false;}
  };
}
function showCompletedActivities(host){
  host.textContent='Đang tải…';
  loadCompletions().then(records=>{
    host.replaceChildren();
    if(!records.size){host.textContent='Chưa có bài được đánh dấu hoàn thành.';return;}
    for(const item of records.values()){
      const row=document.createElement('div');row.className='completed-row';
      const title=document.createElement('span');title.textContent=`${item.level} · ${item.title}`;
      const control=document.createElement('div');row.append(title,control);host.append(row);mountCompletion(control,item,true);
    }
  }).catch(()=>{host.textContent='Chưa tải được danh sách hoàn thành.';});
}
