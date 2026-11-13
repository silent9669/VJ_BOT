import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const script=fs.readFileSync(new URL('../static/source-catalog.js',import.meta.url),'utf8');
const catalog=JSON.parse(fs.readFileSync(new URL('../static/course/learning-sources.json',import.meta.url),'utf8'));

class Element{
  constructor(tag='div'){this.tagName=tag;this.children=[];this.hidden=false;this.value='';this.ownText='';}
  set textContent(value){this.ownText=String(value);this.children=[];}
  get textContent(){return this.ownText+this.children.map(child=>child.textContent).join('');}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.ownText='';this.children=children;}
  setAttribute(name,value){this[name]=value;}
  addEventListener(){}
}

async function page(learningData=structuredClone(catalog)){
  const ids=['source-book','source-search','source-list','source-count','source-retry','source-date',
    'learning-source-list','learning-source-count','learning-source-retry'];
  const elements=Object.fromEntries(ids.map(id=>[id,new Element()]));
  elements['source-book'].value='erin';
  let failLearning=false;
  const context=vm.createContext({
    URL,Date,console,
    document:{getElementById:id=>elements[id],createElement:tag=>new Element(tag)},
    fetch:async path=>{
      if(path==='course/learning-sources.json')return {ok:!failLearning,json:async()=>learningData};
      if(path==='course/sources.json')return {ok:true,json:async()=>({retrieved_at:'2026-11-01',lessons:[]})};
      if(path==='course/erin-resources.json')return {ok:true,json:async()=>({lessons:[{
        book:'erin',title:'Official lesson',number:1,resources:[{title:'Publisher page',url:'https://www.erin.jpf.go.jp/en/lesson01/'}]
      }]})};
      return {ok:true,json:async()=>({resources:[]})};
    }
  });
  vm.runInContext(script,context);
  await new Promise(resolve=>setImmediate(resolve));
  return {elements,failLearning(value){failLearning=value;}};
}

function descendants(element){return element.children.flatMap(child=>[child,...descendants(child)]);}

test('all assessed publishers appear as external references without replacing official materials',async()=>{
  const {elements}=await page();
  const entries=elements['learning-source-list'].children;
  assert.deepEqual(entries.map(row=>row.children[0].textContent),catalog.sources.map(source=>source.name));
  assert.equal(elements['source-list'].children[0].children[0].textContent,'Official lesson');
  const links=entries.flatMap(descendants).filter(element=>element.tagName==='a');
  assert.ok(links.some(link=>link.href==='https://hn.jpf.go.jp/irodori'));
  assert.ok(links.every(link=>link.target==='_blank' && link.rel.includes('noopener')));
  assert.equal(elements['learning-source-retry'].hidden,true);
});

test('a failed reference refresh leaves official materials available and retries through its own button',async()=>{
  const app=await page();
  app.failLearning(true);
  await app.elements['learning-source-retry'].onclick();
  assert.equal(app.elements['learning-source-list'].children.length,0);
  assert.equal(app.elements['learning-source-retry'].hidden,false);
  assert.equal(app.elements['source-list'].children[0].children[0].textContent,'Official lesson');
  app.failLearning(false);
  await app.elements['learning-source-retry'].onclick();
  assert.deepEqual(app.elements['learning-source-list'].children.map(row=>row.children[0].textContent),catalog.sources.map(source=>source.name));
  assert.equal(app.elements['learning-source-retry'].hidden,true);
});

for(const unsafe of ['javascript:alert(1)','https://attacker.example/lesson','https://user:password@www.naoki.edu.vn/lesson']){
  test(`unsafe reference URL never reaches the rendered catalog: ${unsafe}`,async()=>{
    const data=structuredClone(catalog);data.sources[0].links[0].url=unsafe;
    const {elements}=await page(data);
    assert.equal(elements['learning-source-list'].children.length,0);
    assert.equal(elements['learning-source-retry'].hidden,false);
    assert.equal(elements['source-list'].children[0].children[0].textContent,'Official lesson');
  });
}

test('the reference page does not present a granted corpus right from a changed data file',async()=>{
  const data=structuredClone(catalog);data.sources[0].corpus_allowed=true;
  const {elements}=await page(data);
  assert.equal(elements['learning-source-list'].children.length,0);
  assert.equal(elements['learning-source-retry'].hidden,false);
});
