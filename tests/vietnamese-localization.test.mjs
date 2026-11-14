import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const json = path => JSON.parse(readFileSync(path, 'utf8'));

function sourceCatalog() {
  class Node {
    constructor() { this.children = []; this.value = ''; this.textContent = ''; }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; }
    setAttribute(name, value) { this[name] = value; }
    addEventListener() {}
  }
  const nodes = new Map();
  const node = id => {
    if (!nodes.has(id)) nodes.set(id, new Node());
    return nodes.get(id);
  };
  node('source-book').value = 'erin';
  const context = vm.createContext({
    document: {getElementById: node, createElement: () => new Node()},
    Date,
    fetch: async path => ({ok: true, json: async () => json('static/' + path)})
  });
  vm.runInContext(readFileSync('static/vi-labels.js', 'utf8'), context);
  const source = readFileSync('static/source-catalog.js', 'utf8');
  vm.runInContext(source.slice(0, source.indexOf('const learningSourceList=')), context);
  return {context, node};
}

test('source catalog displays Vietnamese and searches both translated and original titles without rewriting links', async () => {
  const {context, node} = sourceCatalog();
  await context.loadSources();
  const source = json('static/course/erin-resources.json').lessons;
  const row = () => node('source-list').children[0];
  assert.equal(row().children[0].textContent, 'Chào hỏi lần đầu gặp mặt · Lớp học');
  assert.equal(row().children[1].children[0].href, source[0].resources[0].url);
  for (const query of ['Nhờ vả', 'Making Requests']) {
    node('source-search').value = query;
    context.renderSources();
    assert.equal(node('source-list').children.length, 1);
    assert.equal(row().children[0].textContent, 'Nhờ vả · Trường học');
    assert.equal(row().children[1].children[0].href, source[1].resources[0].url);
  }
  node('source-book').value = 'starter';
  node('source-search').value = 'Chào buổi sáng';
  context.renderSources();
  assert.equal(node('source-list').children.length, 1);
  assert.equal(row().children[0].textContent, 'Bài 1 · Chào buổi sáng!');
  assert.equal(row().children[1].children[0].href, json('static/course/sources.json').lessons[0].pdf_url);
});

test('grammar formation support preserves Japanese while translating compound terminology before individual words', () => {
  const context = vm.createContext({});
  vm.runInContext(readFileSync('static/vi-labels.js', 'utf8'), context);
  assert.equal(vm.runInContext("viFormula('Verb-volitional + にも + Verb-nai (potential of the same verb)')", context),
    'Động từ thể ý chí + にも + Động từ thể ない (thể khả năng của cùng động từ)');
  assert.equal(vm.runInContext("viFormula('Question word + であれ')", context), 'Từ để hỏi + であれ');
});
