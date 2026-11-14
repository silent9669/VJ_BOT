import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import vm from 'node:vm';

// Exercise the browser entry point with only the DOM/storage boundary replaced.
const file = new URL('../static/local-ui.js', import.meta.url);
function page({hostname = 'localhost', search = '', saved, brokenStorage = false, admin = false} = {}) {
  const elements = [], listeners = {}, observers = [], values = new Map(saved ? [['vjbot_local_ui', saved]] : []);
  const root = {dataset: {}};
  const make = tag => ({tagName: tag.toUpperCase(), children: [], dataset: {}, attributes: {},
    style: {}, append(...nodes) {this.children.push(...nodes);}, prepend(...nodes) {this.children.unshift(...nodes);},
    setAttribute(key, value) {this.attributes[key] = String(value);},
    addEventListener(name, fn) {this[name] = fn;},
    removeAttribute(key) {delete this.attributes[key];}
  });
  const body = make('body'), head = make('head'), adminButton = {hidden:!admin};
  const doc = {documentElement: root, body, head, readyState: 'complete',
    createElement(tag) {const el = make(tag); elements.push(el); return el;},
    addEventListener(name, fn) {listeners[name] = fn;},
    getElementById(id) {return id === 'tab-btn-admin' ? adminButton : null;},
    querySelector() {return null;}
  };
  const context = {document: doc, location: {hostname, search, hash:'#dashboard'}, URLSearchParams,
    localStorage: {getItem(key) {if (brokenStorage) throw Error('blocked'); return values.get(key) ?? null;},
      setItem(key, value) {if (brokenStorage) throw Error('blocked'); values.set(key, value);}},
    addEventListener(name, fn) {listeners[name] = fn;},
    MutationObserver: class {constructor(callback) {observers.push(callback);} observe() {}}
  };
  vm.createContext(context);
  if (existsSync(file)) vm.runInContext(readFileSync(file, 'utf8'), context);
  return {elements, listeners, observers, root, body, head, values, context, adminButton};
}

test('local trial activates on exact loopback hosts and loads local theme assets', () => {
  for (const hostname of ['localhost', '127.0.0.1', '[::1]']) {
    const p = page({hostname});
    assert.equal(p.root.dataset.ui, 'manga');
    assert.ok(p.elements.some(el => el.tagName === 'LINK' && el.href === '/manga.css'));
    assert.ok(p.elements.some(el => el.id === 'local-ui-switch'));
  }
});

test('public and look-alike hosts remain untouched even with an explicit theme query or saved choice', () => {
  for (const hostname of ['vjbot.dangphuc.me', 'localhost.example.com', 'evil-localhost', '192.168.1.10', '127.0.0.1.example.com']) {
    const p = page({hostname, search:'?ui=manga', saved:'manga'});
    assert.equal(p.root.dataset.ui, undefined);
    assert.equal(p.elements.length, 0);
    assert.equal(p.values.get('vjbot_local_ui'), 'manga');
  }
});

test('the local comparison switch restores the original theme without navigation or account mutations', () => {
  const p = page();
  const select = p.elements.find(el => el.id === 'local-ui-switch');
  assert.ok(select, 'local comparison control is mounted');
  select.value = 'current'; select.change();
  assert.equal(p.root.dataset.ui, 'current');
  assert.equal(p.values.get('vjbot_local_ui'), 'current');
  assert.equal(p.context.location.hash, '#dashboard');
  select.value = 'manga'; select.change();
  assert.equal(p.root.dataset.ui, 'manga');
  assert.equal(p.values.get('vjbot_local_ui'), 'manga');
});

test('saved comparison choice survives reload; explicit valid URL choice takes precedence', () => {
  assert.equal(page({saved:'current'}).root.dataset.ui, 'current');
  assert.equal(page({saved:'current',search:'?ui=manga'}).root.dataset.ui, 'manga');
  assert.equal(page({saved:'manga',search:'?ui=current'}).root.dataset.ui, 'current');
  assert.equal(page({saved:'invalid',search:'?ui=not-a-theme'}).root.dataset.ui, 'manga');
});

test('blocked storage does not prevent applying or switching the local theme', () => {
  const p = page({brokenStorage:true});
  assert.equal(p.root.dataset.ui, 'manga');
  const select = p.elements.find(el => el.id === 'local-ui-switch');
  select.value = 'current'; assert.doesNotThrow(() => select.change());
  assert.equal(p.root.dataset.ui, 'current');
});

test('desktop trial navigation uses existing application hashes and reflects the active route', () => {
  const p = page();
  const nav = p.elements.find(el => el.id === 'manga-nav');
  assert.ok(nav, 'navigation exists');
  assert.deepEqual(nav.children.filter(el => el.tagName === 'A').map(el => el.href),
    ['#dashboard', '#curriculum', '#flashcards', '#kanji', '#kaiwa', '#quiz', '#classroom', '#mastery', '#settings', '#admin']);
  const course = nav.children.find(el => el.href === '#curriculum');
  const home = nav.children.find(el => el.href === '#dashboard');
  assert.equal(home.attributes['aria-current'], 'page');
  p.context.location.hash = '#curriculum/N5/lesson/grammar/desu';
  p.listeners.hashchange();
  assert.equal(course.attributes['aria-current'], 'page');
  assert.equal(home.attributes['aria-current'], undefined);
});

test('navigation follows the app pushState flow, which changes data-page without a hashchange event', () => {
  const p = page();
  p.context.location.hash = '#classroom';
  p.body.dataset.page = 'classroom';
  p.observers.forEach(callback => callback([{attributeName:'data-page'}]));
  const nav = p.elements.find(el => el.id === 'manga-nav');
  assert.equal(nav.children.find(el => el.href === '#classroom').attributes['aria-current'], 'page');
  assert.equal(nav.children.find(el => el.href === '#dashboard').attributes['aria-current'], undefined);
});

test('admin navigation mirrors existing account permission and updates after grant or revocation', () => {
  for (const admin of [false,true]) {
    const p = page({admin});
    const link = p.elements.find(el => el.tagName === 'A' && el.href === '#admin');
    assert.ok(link,'admin remains reachable when the desktop sidebar is replaced');
    assert.equal(link.hidden,!admin);
    p.adminButton.hidden=admin;
    p.observers.forEach(callback=>callback([{attributeName:'hidden'}]));
    assert.equal(link.hidden,admin);
  }
});

test('Kanji lesson routes keep Kanji selected rather than losing the active menu', () => {
  const p=page();
  p.context.location.hash='#kanji/N4';
  p.listeners.hashchange();
  const link=p.elements.find(el=>el.tagName==='A' && el.href==='#kanji');
  assert.ok(link,'Kanji link exists');
  assert.equal(link.attributes['aria-current'],'page');
});
