import {createHash} from 'node:crypto';
import {readdirSync, readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {casePacks,selectCases,turnId} from './cases.mjs';

export const MODEL = 'gemini-3.1-flash-lite';
export const PROVIDER = 'https://generativelanguage.googleapis.com';
export const FORMAT = 1;
export const START_SPACING_MS = 4100;
export const sha256 = value=>createHash('sha256').update(value).digest('hex');
export const digest = value=>sha256(JSON.stringify(value));
export const fileURL = (root,file)=>pathToFileURL(resolve(root,file)).href;
const fileHash = (root,file)=>sha256(readFileSync(resolve(root,file)));
const corpusPath = 'static/course/learning-corpus.json';
const builderPath = 'scripts/build_teacher_catalog.mjs';

function checkoutIdentity(root) {
  const files = ['package.json','package-lock.json',builderPath,...['src','migrations'].flatMap(dir=>
    readdirSync(resolve(root,dir),{recursive:true}).map(name=>`${dir}/${name.replaceAll('\\','/')}`)
      .filter(file=>/\.(?:[cm]?js|json|sql)$/.test(file) && file!=='src/prompt.js'))].sort();
  return {prompt_digest:fileHash(root,'src/prompt.js'), transport_digest:digest(files.map(file=>[file,fileHash(root,file)]))};
}

export async function planFor(root, pack) {
  const source = checkoutIdentity(root);
  const items = await selectCases(pack);
  const {buildTeacherCatalog} = await import(fileURL(root,builderPath));
  const catalogs = await buildTeacherCatalog();
  const corpus = readFileSync(resolve(root,corpusPath));
  const levels = [...new Set(items.map(item=>item.level))].sort();
  const taskFor = item=>item.focus?.kind==='question' ? catalogs[item.level]?.lessons[item.lesson.id]?.questions[item.focus.index] : null;
  const turns = items.flatMap(item=>{
    const task = taskFor(item);
    if (item.focus?.kind==='question' && (!task?.task_id || !task.revision || task.unavailable_reason)) throw new Error('A canonical task is unavailable.');
    const calls = Number(item.channel==='chat' || task?.mode!=='choice');
    return item.steps.map(step=>({id:turnId(item,step),item,step,task,calls}));
  });
  if (!turns.length || new Set(turns.map(turn=>turn.id)).size!==turns.length
    || pack==='held-out' && (turns.length!==24 || ['chat','live'].some(channel=>{
      const group = items.filter(item=>item.channel===channel);
      return group.length!==4 || group.some(item=>item.steps.length!==3);
    }))) throw new Error('Invalid planned case coverage.');
  const identity = {format:FORMAT, ...source, pack, protocol:'gemini',model:MODEL,provider:PROVIDER,
    case_digest:digest(items),ground_digest:digest([sha256(corpus),levels.map(level=>[level,catalogs[level]])]),
    recorder_digest:digest(['capture.mjs','cases.mjs','identity.mjs','assert-turn.mjs'].map(file=>sha256(readFileSync(new URL(file,import.meta.url))))),
    node:process.versions.node,spacing_ms:START_SPACING_MS,planned:turns.length,expected_calls:turns.reduce((sum,row)=>sum+row.calls,0)};
  return {identity:{...identity,approval_digest:digest(identity)},turns,catalogs,corpus};
}

if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const [root,pack,...extra] = process.argv.slice(2);
  if (!root || !casePacks.includes(pack) || extra.length) {
    console.error(`Usage: node evals/tutor/identity.mjs <checkout> <${casePacks.join('|')}>`);
    process.exitCode=1;
  } else {
    const {identity,turns} = await planFor(root,pack);
    console.log(JSON.stringify({...identity,turn_ids:turns.map(turn=>turn.id)},null,2));
  }
}
