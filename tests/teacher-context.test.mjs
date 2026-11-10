import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
function page(active,text,title='Bài học'){
  const panel={id:active,innerText:text};
  const document={querySelector:()=>panel,getElementById:id=>id==='topbar-view-title'?{textContent:title}:id==='modal-lesson-title'?{textContent:'〜は'}:null};
  return {panel,document};
}
test('the active learning screen is captured, trimmed and remembered after leaving it',()=>{
  const {panel,document}=page('panel-lesson','  Cấu trúc:   Danh từ + は\n\n\n  Ví dụ  '+'x'.repeat(5000));
  const c=vm.createContext({document,location:{hash:'#curriculum/N5/lesson/grammar/wa'},activeCurriculumLevel:'N5',Date,globalThis:null});c.globalThis=c;
  vm.runInContext(readFileSync('static/teacher-context.js','utf8'),c);
  const live=c.teacherScreen();
  assert.equal(live.route,'curriculum/N5/lesson/grammar/wa');assert.equal(live.title,'〜は');assert.equal(live.level,'N5');assert.ok(live.text.length<=3500);assert.match(live.text,/^Cấu trúc: Danh từ \+ は\nVí dụ/);
  c.markTeacherScreen();c.rememberTeacherScreen();
  panel.id='panel-classroom';c.location.hash='#classroom';
  assert.equal(c.teacherScreen().title,'〜は');
  panel.id='panel-settings';assert.equal(c.teacherScreen().route,'curriculum/N5/lesson/grammar/wa');
});
test('nothing is captured on screens without learning content',()=>{
  const {document}=page('panel-landing','Tiếng Nhật, từng ngày.');
  const c=vm.createContext({document,location:{hash:'#landing'},Date});c.globalThis=c;
  vm.runInContext(readFileSync('static/teacher-context.js','utf8'),c);
  assert.equal(c.teacherScreen(),null);
});
