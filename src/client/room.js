import * as THREE from 'three';
const host=document.getElementById('study-room');
const phrases={book:['本は机の上にあります。','Quyển sách ở trên bàn.'],desk:['机は部屋の中にあります。','Chiếc bàn ở trong phòng.'],chair:['椅子は机の前にあります。','Chiếc ghế ở trước bàn.'],plant:['植物は机の隣にあります。','Chậu cây ở bên cạnh bàn.']};
let selectObject=()=>{};
const objectNames={book:'quyển sách',desk:'chiếc bàn',chair:'chiếc ghế',plant:'chậu cây'};
let quizOrder=[],quizIndex=0,quizAnswered=false,quizMistake=false;
const question=document.getElementById('room-question'),feedback=document.getElementById('room-feedback'),startQuiz=document.getElementById('room-quiz-start');
function nextChallenge(){
  if(quizIndex===quizOrder.length){question.textContent='Đã hoàn thành 4 đồ vật.';startQuiz.textContent='Luyện lại';startQuiz.disabled=false;quizOrder=[];return;}
  question.hidden=false;question.textContent=`${quizIndex+1} / 4 · Chọn ${objectNames[quizOrder[quizIndex]]} trong phòng.`;feedback.textContent='';quizAnswered=false;quizMistake=false;startQuiz.textContent='Câu tiếp';startQuiz.disabled=true;
}
startQuiz.addEventListener('click',()=>{
  if(!quizOrder.length){quizOrder=Object.keys(objectNames);for(let i=quizOrder.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[quizOrder[i],quizOrder[j]]=[quizOrder[j],quizOrder[i]];}quizIndex=0;nextChallenge();}
  else if(quizAnswered){quizIndex++;nextChallenge();}
});
function select(key){
  if(quizOrder.length && !quizAnswered){
    const correct=key===quizOrder[quizIndex];if(!correct)quizMistake=true;feedback.textContent=correct?'Đúng rồi.':'Chưa đúng. Em thử chọn lại.';
    if(correct){quizAnswered=true;startQuiz.disabled=false;window.apiFetch?.('/api/progress/record',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({item_id:`room:N5:${key}`,display:phrases[key][0],level:'N5',item_type:'vocabulary',correct:!quizMistake,quality:quizMistake?2:4})}).then(response=>{if(!response.ok)throw new Error('save');}).catch(()=>{feedback.textContent+=' Chưa lưu được tiến độ.';});}
  }
  const [jp,vi]=phrases[key];document.getElementById('room-word-jp').textContent=jp;document.getElementById('room-word-vi').textContent=vi;document.querySelectorAll('[data-room]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.room===key)));selectObject(key);}
document.querySelectorAll('[data-room]').forEach(b=>b.addEventListener('click',()=>select(b.dataset.room)));
document.getElementById('room-audio').addEventListener('click',()=>window.playGeminiTTS(document.getElementById('room-word-jp').textContent));
select('book');
function mount(){
  const renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,powerPreference:'low-power'});
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.setClearColor(0xf8f3e7,0);host.append(renderer.domElement);host.querySelector('.room-fallback').hidden=true;
  renderer.domElement.setAttribute('aria-label','Phòng học của thầy Lâm; chọn vật bằng các nút bên dưới');renderer.domElement.setAttribute('role','img');
  let angle=0,targetAngle=0,frame=0,visible=false,disposed=false,previous=performance.now(),gestureStart=0;const reduce=matchMedia('(prefers-reduced-motion: reduce)');
  const scene=new THREE.Scene(),room=new THREE.Group();scene.add(room);
  const camera=new THREE.OrthographicCamera(-4,4,3,-3,.1,100);camera.position.set(7,7,9);camera.lookAt(0,1,0);
  scene.add(new THREE.HemisphereLight(0xfffcf0,0xb5aa91,2.4));const sun=new THREE.DirectionalLight(0xffffff,2.2);sun.position.set(-3,7,5);scene.add(sun);
  const resources=[],targets=[];const ink=new THREE.LineBasicMaterial({color:0x4b4b40,transparent:true,opacity:.55});resources.push(ink);
  const materials=new Map();
  function material(color){if(!materials.has(color)){const m=new THREE.MeshStandardMaterial({color,roughness:1});materials.set(color,m);resources.push(m);}return materials.get(color);}
  function box(w,h,d,x,y,z,color,key){const geometry=new THREE.BoxGeometry(w,h,d);resources.push(geometry);const mesh=new THREE.Mesh(geometry,material(color));mesh.position.set(x,y,z);room.add(mesh);const edges=new THREE.EdgesGeometry(geometry);resources.push(edges);mesh.add(new THREE.LineSegments(edges,ink));if(key){mesh.userData.key=key;targets.push(mesh);}return mesh;}
  box(6.5,.18,4.7,0,-.1,0,0xd5c8ac);
  for(let i=0;i<8;i++)box(.018,.008,4.55,-2.8+i*.8,.002,0,0xb9ad93);
  box(6.5,3.6,.14,0,1.72,-2.3,0xece6d7);
  box(.14,3.6,4.7,-3.2,1.72,0,0xe3dfcf);
  // Blackboard, frame and chalk tray.
  box(3.2,1.6,.12,.3,2.35,-2.16,0x8c7657);box(3,1.4,.03,.3,2.35,-2.08,0x41574e);box(3.2,.08,.24,.3,1.52,-2.02,0xa18b68);
  const chalk=document.createElement('canvas');chalk.width=512;chalk.height=256;const ctx=chalk.getContext('2d');ctx.fillStyle='#41574e';ctx.fillRect(0,0,512,256);ctx.fillStyle='#f5f0df';ctx.textAlign='center';ctx.font='38px sans-serif';ctx.fillText('日本語の教室',256,94);ctx.font='27px sans-serif';ctx.fillText('本 ・ 机 ・ 椅子',256,160);const chalkTexture=new THREE.CanvasTexture(chalk);chalkTexture.colorSpace=THREE.SRGBColorSpace;resources.push(chalkTexture);const chalkMat=new THREE.MeshBasicMaterial({map:chalkTexture});resources.push(chalkMat);const chalkGeo=new THREE.PlaneGeometry(2.85,1.32);resources.push(chalkGeo);const board=new THREE.Mesh(chalkGeo,chalkMat);board.position.set(.3,2.35,-2.055);room.add(board);
  // Desk has four separate legs seated on the floor.
  box(2.7,.15,1.35,0,1.25,.35,0xc8aa77,'desk');
  for(const x of [-1.18,1.18])for(const z of [-.18,.88])box(.13,1.17,.13,x,.59,z,0x8c795d,'desk');
  // Open book, pencil and stacked notebooks.
  box(.64,.055,.65,-.42,1.36,.28,0xf6efd9,'book').rotation.z=-.05;box(.64,.055,.65,.22,1.36,.28,0xfff8e7,'book').rotation.z=.05;
  box(.055,.06,.68,-.1,1.37,.28,0xb74a36,'book');
  for(let i=0;i<4;i++)box(.45,.005,.008,-.42,1.395,.08+i*.11,0xb6ab92,'book');
  box(.05,.04,.6,.67,1.36,.3,0xa54a35);box(.5,.08,.7,.94,1.38,-.1,0x738775,'book');
  // Chair in front of the desk, offset to make the book visible.
  box(.84,.12,.8,.65,.7,1.65,0xb9a47c,'chair');box(.84,.85,.12,.65,1.16,2,0xb9a47c,'chair');
  for(const x of [.32,.98])for(const z of [1.34,1.96])box(.1,.68,.1,x,.34,z,0x8a795e,'chair');
  // Potted plant to the right.
  const potGeo=new THREE.CylinderGeometry(.35,.26,.55,8);resources.push(potGeo);const pot=new THREE.Mesh(potGeo,material(0xab6b50));pot.position.set(2.45,.28,-.6);pot.userData.key='plant';targets.push(pot);room.add(pot);
  box(.07,1.1,.07,2.45,1.05,-.6,0x5d7052,'plant');
  for(let i=0;i<7;i++){const g=new THREE.SphereGeometry(.23,6,4);resources.push(g);const leaf=new THREE.Mesh(g,material(i%2?0x738666:0x536c51));leaf.scale.set(1.6,.5,.7);leaf.position.set(2.45+Math.sin(i*2)*.3,.7+i*.13,-.6+Math.cos(i*2)*.22);leaf.rotation.z=i%2?.55:-.55;leaf.userData.key='plant';targets.push(leaf);room.add(leaf);}
  // The same original pixel teacher used by chat, settings and the dock.
  const teacher=new THREE.Sprite(new THREE.SpriteMaterial({transparent:true,depthWrite:false}));teacher.position.set(-1.25,1.25,1.1);teacher.scale.set(1.35,2.4,1);room.add(teacher);resources.push(teacher.material);
  new THREE.TextureLoader().load('/assets/lam/teacher.svg',texture=>{if(disposed){texture.dispose();return;}texture.magFilter=THREE.NearestFilter;texture.minFilter=THREE.NearestFilter;texture.colorSpace=THREE.SRGBColorSpace;teacher.material.map=texture;teacher.material.needsUpdate=true;resources.push(texture);render();});
  const ringGeo=new THREE.TorusGeometry(.48,.018,4,40);resources.push(ringGeo);const ringMat=new THREE.MeshBasicMaterial({color:0xad392e});resources.push(ringMat);const ring=new THREE.Mesh(ringGeo,ringMat);ring.rotation.x=-Math.PI/2;room.add(ring);
  const ringPositions={book:[-.1,1.43,.3],desk:[0,1.34,.35],chair:[.65,.79,1.65],plant:[2.45,.02,-.6]};
  selectObject=key=>{ring.position.set(...ringPositions[key]);gestureStart=performance.now();if(reduce.matches)render();else schedule();};selectObject('book');
  function render(){if(disposed)return;renderer.render(scene,camera);host.dataset.drawCalls=String(renderer.info.render.calls);host.dataset.triangles=String(renderer.info.render.triangles);}
  function tick(now){frame=0;if(!visible||document.hidden||disposed)return;const delta=Math.min((now-previous)/1000,.05);previous=now;angle+=(targetAngle-angle)*(1-Math.exp(-8*delta));room.rotation.y=angle;const gesture=Math.min(1,(now-gestureStart)/450);teacher.position.y=1.25+(reduce.matches?0:Math.sin(gesture*Math.PI)*.08);teacher.material.rotation=reduce.matches?0:Math.sin(gesture*Math.PI)*.025;render();if((Math.abs(targetAngle-angle)>.001||gesture<1)&&!reduce.matches)frame=requestAnimationFrame(tick);}
  function schedule(){if(!frame&&visible&&!document.hidden){previous=performance.now();frame=requestAnimationFrame(tick);}}
  const ray=new THREE.Raycaster(),pointer=new THREE.Vector2();
  renderer.domElement.addEventListener('pointerup',event=>{const rect=renderer.domElement.getBoundingClientRect();pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);ray.setFromCamera(pointer,camera);const hit=ray.intersectObjects(targets,false)[0];if(hit)select(hit.object.userData.key);});
  const orbit=document.getElementById('room-angle');orbit.addEventListener('input',()=>{targetAngle=Number(orbit.value)*Math.PI/180;if(reduce.matches){angle=targetAngle;room.rotation.y=angle;render();}else schedule();});
  const resize=new ResizeObserver(()=>{const w=host.clientWidth,h=host.clientHeight;renderer.setSize(w,h,false);camera.left=-3.8*w/h;camera.right=3.8*w/h;camera.top=3.8;camera.bottom=-3.8;camera.updateProjectionMatrix();render();});resize.observe(host);
  const observer=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;if(visible)schedule();else{cancelAnimationFrame(frame);frame=0;}});observer.observe(host);
  const onVisible=()=>{if(document.hidden){cancelAnimationFrame(frame);frame=0;}else schedule();};document.addEventListener('visibilitychange',onVisible);
  window.addEventListener('pagehide',()=>{disposed=true;cancelAnimationFrame(frame);resize.disconnect();observer.disconnect();document.removeEventListener('visibilitychange',onVisible);resources.forEach(r=>r.dispose());renderer.dispose();},{once:true});
  renderer.domElement.addEventListener('webglcontextlost',event=>{event.preventDefault();host.querySelector('.room-fallback').hidden=false;renderer.domElement.hidden=true;});
}
try{mount();}catch{host.dataset.fallback='true';}
