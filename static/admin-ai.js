(function () {
  const el=id=>document.getElementById(id);
  const areas={account:'settings-account-card',api:'ai-card',admin:'settings-admin-ai',sound:'settings-sound-card',data:'settings-danger-card'};
  let models=[],loading=0,renderedOwner=null,renderedAdmin=false;
  window.showSettingsArea = area => {
    const admin=signedInUser?.is_admin===true;
    if(admin && area==='api')area='admin';
    if(!Object.hasOwn(areas,area) || (area==='admin' && !admin))area='account';
    el('settings-api-nav').hidden=admin;
    el('settings-admin-nav').hidden=!admin;
    for(const [key,id] of Object.entries(areas))el(id).hidden=key!==area;
    document.querySelectorAll('.settings-nav button').forEach(button=>{
      if(button.dataset.settings===area)button.setAttribute('aria-current','true');else button.removeAttribute('aria-current');
    });
    document.querySelector('#panel-settings h1').textContent={account:'Tài khoản',api:'Kết nối AI',admin:'Model quản trị',sound:'Âm thanh',data:'Dữ liệu'}[area];
    return area;
  };
  const option=(value,label=value)=>{const node=document.createElement('option');node.value=value;node.textContent=label;return node;};
  const efforts={'':'Không áp dụng',none:'Tắt',low:'Thấp · nhanh',medium:'Vừa',high:'Cao',xhigh:'Rất cao'};
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
    el('admin-ai-message').textContent='Đang tải cấu hình OpenAI quản trị…';
    models=[];
    el('admin-text-model').replaceChildren();
    el('admin-reasoning').replaceChildren();
    el('admin-live-voice').replaceChildren();
    const current=()=>run===loading && owner===signedInUser?.user_id && signedInUser?.is_admin===true;
    try {
      const response=await apiFetch('/api/admin/ai'),data=await response.json();
      if(!current())return;
      if(!response.ok)throw new Error(data.detail);
      models=data.models;
      el('admin-text-model').replaceChildren(...models.map(model=>option(model.id)));
      el('admin-live-voice').replaceChildren(...data.voices.map(voice=>option(voice,{shida:'Shida · Nam · Nhật',harema:'Harema · Nữ · Nhật',marin:'Marin',cedar:'Cedar'}[voice])));
      el('admin-text-model').value=data.settings.model;
      el('admin-live-voice').value=data.settings.live_voice;
      reasoning(data.settings.reasoning_effort);
      el('admin-ai-message').textContent=data.configured
        ? 'OpenAI máy chủ tự động cho chat, đọc thành tiếng và GPT-Live. Lưu model riêng cho tài khoản này.'
        : 'Chưa cấu hình OPENAI_API_KEY trên máy chủ. Chat, đọc thành tiếng và GPT-Live sẽ báo lỗi; không dùng API cá nhân thay thế.';
      window.renderVoiceProfiles?.(owner,[],false,{configured:data.configured});
    } catch(error) {
      if(current())el('admin-ai-message').textContent=error.message || 'Không tải được cấu hình OpenAI quản trị. Kiểm tra quyền quản trị và cấu hình máy chủ.';
    }
    finally {if(current())el('admin-ai-save').disabled=!models.length;}
  };
  el('admin-text-model').addEventListener('change',()=>reasoning());
  el('admin-reasoning').addEventListener('change',preview);
  el('admin-live-voice').addEventListener('change',preview);
  el('admin-ai-form').addEventListener('submit',async event=>{
    event.preventDefault();const button=el('admin-ai-save');if(button.disabled || !signedInUser?.is_admin)return;
    const owner=signedInUser.user_id,run=++loading;
    const current=()=>run===loading && owner===signedInUser?.user_id && signedInUser?.is_admin===true;
    button.disabled=true;el('admin-ai-message').textContent='Đang lưu…';
    try {
      const response=await apiFetch('/api/admin/ai',{method:'PUT',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({model:el('admin-text-model').value,reasoning_effort:el('admin-reasoning').value,live_voice:el('admin-live-voice').value})});
      const data=await response.json();if(!current())return;
      if(!response.ok)throw new Error(data.detail);
      el('admin-ai-message').textContent='Đã lưu. Áp dụng cho tin nhắn và cuộc gọi mới.';
      globalThis.aiConnectionChanged?.();
    } catch(error){if(current())el('admin-ai-message').textContent=error.message || 'Không lưu được cài đặt.';}
    finally {if(current())button.disabled=false;}
  });
  window.addEventListener('vjbot-voice-changed',()=>{
    const owner=signedInUser?.user_id || null,admin=signedInUser?.is_admin===true;
    if(owner===renderedOwner && admin===renderedAdmin)return;
    renderedOwner=owner;renderedAdmin=admin;loading++;models=[];
    el('admin-ai-save').disabled=true;
    el('admin-model-preview').textContent='Đang tải cấu hình…';
    el('admin-ai-message').textContent='';
    el('settings-api-nav').hidden=admin;
    el('settings-admin-nav').hidden=!admin;
    const area=Object.entries(areas).find(([,id])=>!el(id).hidden)?.[0] || 'account';
    if(admin)el('ai-card').hidden=true;
    if(!admin)el('settings-admin-ai').hidden=true;
    if(document.body.dataset.page==='settings')
      switchTab('settings',{view:area==='admin' && !admin?'api':area});
  });
})();
