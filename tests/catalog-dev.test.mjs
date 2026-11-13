import test from 'node:test';
import assert from 'node:assert/strict';
import {teacherCatalog} from '../src/tutor-context.js';

test('internal lesson assets pass the local dev host boundary without a network fallback',async()=>{
  const catalog={lessons:{one:{title:'〜は'}},items:{},scenarios:{}};
  const env={ASSETS:{fetch:async request=>{
    const url=new URL(request.url);
    assert.equal(url.pathname,'/course/teacher-N5.json');
    // Vite's ASSETS bridge applies its localhost host validation too.
    return url.hostname==='localhost' || url.hostname.endsWith('.localhost')
      ? Response.json(catalog) : new Response('Blocked host',{status:403});
  }}};
  assert.deepEqual(await teacherCatalog(env,'N5'),catalog);
  assert.equal(await teacherCatalog(env,'N9'),null);
});

test('public catalog requests share one in-flight parse, evict another level and retry failures',async()=>{
  let reads=0,fail=false;
  const catalog={lessons:{},items:{},scenarios:{}};
  const env={ASSETS:{fetch:async()=>{reads++;return fail?new Response('unavailable',{status:503}):Response.json(catalog);}}};
  await Promise.all([teacherCatalog(env,'N5'),teacherCatalog(env,'N5')]);assert.equal(reads,1);
  await teacherCatalog(env,'N5');assert.equal(reads,1);
  await teacherCatalog(env,'N4');await teacherCatalog(env,'N5');assert.equal(reads,3);
  fail=true;assert.equal(await teacherCatalog(env,'N3'),null);
  fail=false;assert.deepEqual(await teacherCatalog(env,'N3'),catalog);assert.equal(reads,5);
  const other={ASSETS:{fetch:async()=>{reads++;return Response.json(catalog);}}};
  await teacherCatalog(other,'N3');assert.equal(reads,6);
});
