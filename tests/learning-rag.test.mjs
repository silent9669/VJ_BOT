import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {attributedReply,learningQuery,retrieveLearning} from '../src/learning-rag.js';

const corpus=()=>({version:1,authorization:{basis:'user_asserted_rights'},chunks:[
  {id:'NK-111111111111-1',source_id:'naoki',title:'Trợ từ は (wa)',url:'https://www.naoki.edu.vn/thu-vien/nguphap/01-tro-tu-wa',text:'は nêu chủ đề. 私は学生です。 Hãy giữ chủ đề của câu.'},
  {id:'MK-222222222222-1',source_id:'mokumoku',title:'〜ておく chuẩn bị trước',url:'https://mokumoku.vn/grammar/n4/te-oku-junbi',text:'V-て+おきます. Làm việc gì đó trước để chuẩn bị cho một mục đích trong tương lai. ホテルを予約しておきます。'}
]});
const environment=value=>({ASSETS:{fetch:async()=>Response.json(value)}});

test('Vietnamese accent folding and Japanese patterns retrieve the relevant attributed passage',async()=>{
  const env=environment(corpus());
  for(const query of ['chuẩn bị trước','chuan bi truoc','ておく']){
    const result=await retrieveLearning(env,query);
    assert.equal(result.status,'matched');assert.equal(result.passages[0].source_id,'mokumoku');
  }
  const particle=await retrieveLearning(env,'は');
  assert.equal(particle.passages[0].source_id,'naoki');
  assert.equal((await retrieveLearning(env,'quantum astrophysics')).status,'no_match');
});

test('a short citation ID resolves exactly and source headers are server-owned',async()=>{
  const result=await retrieveLearning(environment(corpus()),'Tra mã NK-111111111111-1');
  assert.equal(result.passages[0].id,'NK-111111111111-1');
  assert.match(attributedReply('Em thử đặt câu nhé.',result),/^Nguồn: Naoki \[NK-111111111111-1\]/);
  assert.equal(attributedReply('Không có dữ liệu.',{status:'no_match',passages:[]}), 'Không có dữ liệu.');
});

test('unsubmitted assessment retrieval is withheld without loading an answer-bearing corpus',async()=>{
  let reads=0;
  const env={ASSETS:{fetch:async()=>{reads++;return Response.json(corpus());}}};
  const result=await retrieveLearning(env,'は',{assessment:true});
  assert.deepEqual(result,{status:'withheld_for_assessment',passages:[]});assert.equal(reads,0);
});

test('missing, corrupt, disallowed-NHK and foreign-origin assets are explicit unavailability, not retrieved evidence',async()=>{
  for(const mutate of [data=>{data.version=99;},data=>{data.chunks[0].url='https://attacker.example/lesson';},
    data=>{data.chunks[0].source_id='nhk';},data=>{data.chunks[0].source_name='Invented authority';data.chunks[0].id='invalid';}]){
    const data=corpus();mutate(data);
    assert.deepEqual(await retrieveLearning(environment(data),'は'),{status:'unavailable',passages:[]});
  }
  assert.equal((await retrieveLearning({ASSETS:{fetch:async()=>new Response('missing',{status:404})}},'は')).status,'unavailable');
});

test('concurrent readers share a successful public parse, failed reads can recover, and excerpt payload stays bounded',async()=>{
  let reads=0,fail=true;
  const env={ASSETS:{fetch:async()=>{reads++;return fail?new Response('missing',{status:503}):Response.json(corpus());}}};
  assert.equal((await retrieveLearning(env,'は')).status,'unavailable');
  fail=false;
  const results=await Promise.all([retrieveLearning(env,'は'),retrieveLearning(env,'は')]);
  assert.equal(reads,2);assert.ok(results.every(result=>result.status==='matched'));
  assert.ok(results.every(result=>result.passages.length<=3 && result.passages.every(passage=>passage.text.length<=1400)));
});

test('actual captured corpus is addressable by short ID and retains all seven source outcomes',async()=>{
  const actual=JSON.parse(fs.readFileSync(new URL('../static/course/learning-corpus.json',import.meta.url),'utf8'));
  assert.deepEqual(actual.coverage.map(row=>row.source_id).sort(),['freetag','irodori','mokumoku','naoki','nhk','saromalang','tiengnhatdongian']);
  assert.equal(actual.coverage.find(row=>row.source_id==='nhk').status,'blocked');
  assert.ok(!actual.chunks.some(chunk=>chunk.source_id==='nhk'));
  const first=actual.chunks[0],result=await retrieveLearning(environment(actual),first.id);
  assert.equal(result.passages[0].id,first.id);
  assert.ok(actual.chunks.every(chunk=>chunk.header.startsWith('Nguồn: ') && chunk.header.includes(chunk.id)));
  assert.equal(actual.authorization.publisher_permission_independently_verified,false);
});

test('query building does not serialize canonical answer keys into retrieval',()=>{
  const query=learningQuery({title:'Trợ từ は',goal:'Chủ đề',overview:{formula:'N は N です',answer:'SECRET'},questions:[{ans:'SECRET'}]},'Giải thích は');
  assert.doesNotMatch(query,/SECRET/);assert.match(query,/は/);
});

test('body relevance separates sections sharing a title and complete citation IDs do not collide',async()=>{
  const data=corpus();
  data.chunks=[1,10,100].map((number,index)=>({...data.chunks[0],id:`NK-111111111111-${number}`,
    title:'Chào hỏi すみません',text:index===2?'すみません dùng khi xin lỗi và cám ơn.':'こんにちは là lời chào thông thường.'}));
  const env=environment(data);
  assert.equal((await retrieveLearning(env,'すみません')).passages[0].id,'NK-111111111111-100');
  assert.equal((await retrieveLearning(env,'Tra NK-111111111111-100')).passages[0].id,'NK-111111111111-100');
  assert.equal((await retrieveLearning(env,'Tra NK-111111111111-10')).passages[0].id,'NK-111111111111-10');
});

test('canonical selected target informs retrieval without serializing answers or grading keys',()=>{
  const query=learningQuery({title:'Từ vựng',goal:'Ôn tập'},'',{jp:'ておく',vi:'chuẩn bị trước',ans:'SECRET',explanation:'SECRET'});
  assert.match(query,/ておく/);assert.doesNotMatch(query,/SECRET/);
});

test('source attribution cannot expand a reply beyond its consumer contract or truncate source IDs',()=>{
  const retrieval={status:'matched',passages:[{source_name:'Naoki',id:'NK-111111111111-1'}]};
  assert.equal(attributedReply('x'.repeat(2000),retrieval,2000),null);
  assert.match(attributedReply('x'.repeat(1800),retrieval,2000),/^Nguồn: Naoki \[NK-111111111111-1\]/);
});
