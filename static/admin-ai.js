(function () {
  const el=id=>document.getElementById(id);
  const areas={account:'settings-account-card',api:'ai-card',admin:'settings-admin-ai',sound:'settings-sound-card',data:'settings-danger-card'};
  let models=[],loading=0;
  window.showSettingsArea = area => {
    if(!Object.hasOwn(areas,area) || (area==='admin' && !signedInUser?.is_admin))area='account';
    for(const [key,id] of Object.entries(areas))el(id).hidden=key!==area;
    document.querySelectorAll('.settings-nav button').forEach(button=>{
      if(button.dataset.settings===area)button.setAttribute('aria-current','true');else button.removeAttribute('aria-current');
    });
    document.querySelector('#panel-settings h1').textContent={account:'Tài khoản',api:'Kết nối AI',admin:'Model quản trị',sound:'Âm thanh',data:'Dữ liệu'}[area];
  };
  const option=(value,label=value)=>{const node=document.createElement('option');node.value=value;node.textContent=label;return node;};
  const efforts={'':'Không áp dụng',none:'Tắt',low:'Thấp · nhanh',medium:'Vừa',high:'Cao',xhigh:'Rất cao',max:'Tối đa'};
  function reasoning(value='') {
    const available=models.find(model=>model.id===el('admin-text-model').value)?.efforts || [];
    el('admin-reasoning').replaceChildren(...(available.length?available:['']).map(effort=>option(effort,efforts[effort])));
    el('admin-reasoning').disabled=!available.length;
    el('admin-reasoning').value=available.includes(value)?value:available.includes('low')?'low':'';
    preview();
  }
  function preview() {
    el('admin-model-preview').textContent=[el('admin-text-model').value,efforts[el('admin-reasoning').value],`GPT-Live · ${el('admin-live-voice').value}`].filter(Boolean).join(' / ');
  }
  window.renderAdminAISettings = async () => {
    if(!signedInUser?.is_admin)return;
    const run=++loading,owner=signedInUser.user_id;
    el('admin-ai-save').disabled=true;
    try {
      const response=await apiFetch('/api/admin/ai'),data=await response.json();
      if(run!==loading || owner!==signedInUser?.user_id)return;
      if(!response.ok)throw new Error(data.detail);
      models=data.models;
      el('admin-text-model').replaceChildren(...models.map(model=>option(model.id,model.label || model.id)));
      el('admin-live-voice').replaceChildren(...data.voices.map(voice=>option(voice,{shida:'Shida · Nam · Nhật',harema:'Harema · Nữ · Nhật',marin:'Marin',cedar:'Cedar'}[voice])));
      el('admin-text-model').value=data.settings.model;
      el('admin-live-voice').value=data.settings.live_voice;
      reasoning(data.settings.reasoning_effort);
      el('admin-ai-message').textContent=data.configured?'OpenAI quản trị · Lưu riêng cho tài khoản này.':'Chưa có OpenAI key trên máy chủ.';
    } catch(error) {el('admin-ai-message').textContent=error.message || 'Không tải được cài đặt.';}
    finally {el('admin-ai-save').disabled=false;}
  };
  el('admin-text-model').addEventListener('change',()=>reasoning());
  el('admin-reasoning').addEventListener('change',preview);
  el('admin-live-voice').addEventListener('change',preview);
  el('admin-ai-form').addEventListener('submit',async event=>{
    event.preventDefault();const button=el('admin-ai-save');if(button.disabled)return;
    const owner=signedInUser?.user_id;
    button.disabled=true;el('admin-ai-message').textContent='Đang lưu…';
    try {
      const response=await apiFetch('/api/admin/ai',{method:'PUT',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({model:el('admin-text-model').value,reasoning_effort:el('admin-reasoning').value,live_voice:el('admin-live-voice').value})});
      const data=await response.json();if(owner!==signedInUser?.user_id)return;
      if(!response.ok)throw new Error(data.detail);
      el('admin-ai-message').textContent='Đã lưu. Áp dụng cho tin nhắn và cuộc gọi mới.';
      globalThis.aiConnectionChanged?.();
    } catch(error){el('admin-ai-message').textContent=error.message || 'Không lưu được cài đặt.';}
    finally {button.disabled=false;}
  });
})();
