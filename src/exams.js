import catalog from '../static/course/exams.json' with {type:'json'};
export function validExamState(body){
  const paper=catalog.papers.find(p=>`${p.level}:${p.year}`===body.paper_id);
  if(!paper)return false;
  return /^N[1-5]:(2012|2018)$/.test(body.paper_id || '') &&
    ['ready','running','break','finished'].includes(body.status) &&
    Number.isInteger(body.section) && body.section>=0 && body.section<paper.sections.length &&
    Number.isFinite(body.deadline) && body.deadline>=0 && body.deadline<=Date.now()+3*60*60*1000 &&
    Array.isArray(body.answers) && body.answers.length===paper.sections.length && body.answers.every((section,i)=>Array.isArray(section) && section.length===paper.sections[i].groups.reduce((n,g)=>n+g.answers.length,0) && section.every(a=>a===null || Number.isInteger(a) && a>=1 && a<=4));
}
export async function examRoute(request,url,env,userId){
  if(request.method==='GET'){
    const paper=url.searchParams.get('paper_id');
    if(!/^N[1-5]:(2012|2018)$/.test(paper || ''))return Response.json({detail:'Invalid paper'},{status:400});
    const row=await env.DB.prepare('SELECT state_json FROM exam_attempts WHERE user_id=? AND paper_id=?').bind(userId,paper).first();
    return Response.json({attempt:row?JSON.parse(row.state_json):null},{headers:{'Cache-Control':'no-store'}});
  }
  if(request.method==='POST'){
    const body=await request.json();
    if(!validExamState(body))return Response.json({detail:'Invalid exam state'},{status:400});
    const {paper_id,status,section,deadline,answers}=body;
    await env.DB.prepare('INSERT INTO exam_attempts(user_id,paper_id,state_json,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id,paper_id) DO UPDATE SET state_json=excluded.state_json,updated_at=excluded.updated_at').bind(userId,paper_id,JSON.stringify({paper_id,status,section,deadline,answers}),new Date().toISOString()).run();
    return Response.json({ok:true},{headers:{'Cache-Control':'no-store'}});
  }
  return Response.json({detail:'Method not allowed'},{status:405});
}
