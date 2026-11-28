// Store completed streams only. Cache identity is scoped to account, route and configuration.
(function () {
  const limit = 30 * 1024 * 1024, memoryLimit = 8 * 1024 * 1024, maxEntries = 256;
  const memory = new Map();
  let size = 0, opening;
  function remember(key, record) {
    size -= memory.get(key)?.size || 0;
    memory.delete(key);
    if (record.size > memoryLimit) return;
    memory.set(key,record); size += record.size;
    while (size > memoryLimit || memory.size > maxEntries) {
      const oldest=memory.keys().next().value;
      size -= memory.get(oldest).size; memory.delete(oldest);
    }
  }
  function database() {
    if (!opening) opening=new Promise((resolve,reject)=>{
      const request=indexedDB.open('vjbot_voice_audio_v2',1);
      request.onupgradeneeded=()=>request.result.createObjectStore('cache');
      request.onsuccess=()=>{request.result.onversionchange=()=>{request.result.close();opening=null;};resolve(request.result);};
      request.onerror=request.onblocked=()=>reject(request.error);
    }).catch(error=>{opening=null;throw error;});
    return opening;
  }
  async function transact(enqueue) {
    const db=await database();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('cache','readwrite');
      let result;
      tx.oncomplete=()=>resolve(result);
      tx.onerror=tx.onabort=()=>reject(tx.error);
      enqueue(tx.objectStore('cache'),value=>{result=value;});
    });
  }
  async function get(key, persist) {
    const hit=memory.get(key);
    if (hit) {remember(key,hit);return hit.segments;}
    if (!persist) return null;
    try {
      const record=await transact((store,done)=>{
        const lookup=store.get(key);
        lookup.onsuccess=()=>{
          const row=lookup.result;
          if (!row) return;
          const metadata=store.get('index');
          metadata.onsuccess=()=>{
            const entries=metadata.result;
            const index=entries?.findIndex(entry=>entry[0]===key) ?? -1;
            if (index < 0) {store.delete(key);return;}
            entries.push(...entries.splice(index,1));
            store.put(entries,'index');done(row);
          };
        };
      });
      if (record) {remember(key,record);return record.segments;}
    } catch { /* Storage is optional; a miss still uses the selected provider. */ }
    return null;
  }
  async function put(key,segments,persist) {
    const item={size:segments.reduce((total,part)=>total + part.audioBase64.length,0) * 2,segments};
    remember(key,item);
    if (!persist || item.size > limit) return;
    try {
      await transact(store=>{
        const index=store.get('index');
        index.onsuccess=()=>{
          const entries=(index.result || []).filter(row=>row[0]!==key);
          entries.push([key,item.size]);
          let total=entries.reduce((bytes,row)=>bytes+row[1],0), cut=0;
          while(total > limit || entries.length-cut > maxEntries) {
            const [id,bytes]=entries[cut++];total-=bytes;store.delete(id);
          }
          store.put(item,key);store.put(entries.slice(cut),'index');
        };
      });
    } catch { /* A full or disabled IndexedDB does not interrupt playback. */ }
  }
  async function key(identity,text,reference) {
    // Older recordings do not retain the explicit blank pause.
    const bytes=new TextEncoder().encode(JSON.stringify(['synthesis-5',identity,text.normalize('NFC'),reference]));
    const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
    return Array.from(digest,byte=>byte.toString(16).padStart(2,'0')).join('');
  }
  window.VJVoiceCache=Object.freeze({key,get,put,clearMemory(){memory.clear();size=0;}});
})();
