'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

async function testNetworkBoundary() {
  const dom = new JSDOM('<!doctype html><a id="home" href="#top">Home</a><a id="register" href="./register.html">Register</a><a id="line" href="https://line.me/">LINE</a>', {
    url: 'http://127.0.0.1:4173/',
    runScripts: 'outside-only'
  });
  const w = dom.window;
  let fetchCalls = 0;
  w.fetch = async () => { fetchCalls++; return { ok: true }; };
  class FakeXHR {
    open() { this.opened = true; }
    send() { this.sent = true; }
  }
  w.XMLHttpRequest = FakeXHR;
  function FakeWebSocket() {}
  Object.assign(FakeWebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
  w.WebSocket = FakeWebSocket;
  w.EventSource = function FakeEventSource() {};
  let beacons = 0;
  Object.defineProperty(w.navigator, 'sendBeacon', {
    configurable: true,
    value: () => { beacons++; return true; }
  });
  w.open = () => ({ opened: true });

  vm.runInContext(read('web/offline-guard.js'), dom.getInternalVMContext());
  assert.equal(w.FINANCE_OFFLINE_SANDBOX, true);
  assert.equal(w.FINANCE_OFFLINE_NETWORK_POLICY, 'no-runtime-network');

  await assert.rejects(w.fetch('https://example.supabase.co/rest/v1/profiles'), /Offline Sandbox/);
  await assert.rejects(w.fetch('/rest/v1/profiles', { method: 'GET' }), /Offline Sandbox/);
  assert.equal(fetchCalls, 0, 'fetch must never reach the native implementation');

  const xhr = new w.XMLHttpRequest();
  assert.throws(() => xhr.open('POST', '/functions/v1/finance-api'), /Offline Sandbox/);
  assert.throws(() => xhr.send(), /Offline Sandbox/);

  assert.throws(() => new w.WebSocket('wss://example.supabase.co/realtime/v1'), /Offline Sandbox/);
  assert.throws(() => new w.EventSource('https://example.test/events'), /Offline Sandbox/);
  assert.equal(w.navigator.sendBeacon('https://example.test/collect', 'x'), false);
  assert.equal(beacons, 0, 'sendBeacon must not reach the native implementation');
  assert.equal(w.open('https://line.me/'), null);

  const localAnchor = w.document.getElementById('home');
  const localClick = new w.MouseEvent('click', { bubbles: true, cancelable: true });
  localAnchor.dispatchEvent(localClick);
  assert.equal(localClick.defaultPrevented, false, 'same-page hash links remain usable');

  const registerClick = new w.MouseEvent('click', { bubbles: true, cancelable: true });
  w.document.getElementById('register').dispatchEvent(registerClick);
  assert.equal(registerClick.defaultPrevented, true, 'live registration page navigation is blocked');

  const lineClick = new w.MouseEvent('click', { bubbles: true, cancelable: true });
  w.document.getElementById('line').dispatchEvent(lineClick);
  assert.equal(lineClick.defaultPrevented, true, 'external LINE navigation is blocked');

  const index = read('web/index.html');
  assert.match(index, /connect-src 'none'/);
  assert.match(index, /form-action 'none'/);
  assert.ok(index.indexOf('offline-guard.js') < index.indexOf('config.js'), 'network guard loads before application scripts');

  const server = read('scripts/offline-server.cjs');
  assert.match(server, /127\.0\.0\.1/);
  assert.match(server, /req\.method !== 'GET' && req\.method !== 'HEAD'/);
  assert.match(server, /not available in Offline Sandbox/);
  dom.window.close();
}

async function testMockApi() {
  const dom = new JSDOM('<!doctype html>', {
    url: 'http://127.0.0.1:4173/',
    runScripts: 'outside-only'
  });
  const context = dom.getInternalVMContext();
  vm.runInContext("let user = {id:'a1',role:'admin',name:'แอดมินตัวอย่าง',student_id:'ADMIN'}; let db = {announcements:[],notifications:[]};", context);
  vm.runInContext(read('web/offline-api.js'), context);
  const api = dom.window.financeOfflineApi;

  const initial = await api('shop-list');
  assert.ok(initial.products.length >= 2, 'mock shop data is available');
  assert.equal(initial.orders.length >= 1, true, 'mock orders are available');

  const saved = await api('shop-save', {
    title: 'สินค้าใหม่สำหรับทดสอบ',
    description: 'ข้อมูลจำลอง',
    price: 99,
    stock: 4,
    active: true,
    option_groups: []
  });
  assert.equal(saved.simulated, undefined);
  const productId = saved.product.id;
  const file = new dom.window.File(['sandbox-image'], 'sample.png', { type: 'image/png' });
  const upload = await api('shop-upload', { id: productId }, file);
  assert.equal(upload.simulated, true);
  assert.match(upload.path, /^data:image\/png;base64,/);
  const afterUpload = await api('shop-list');
  assert.equal(afterUpload.products.find(item => item.id === productId).images.length, 1);

  const order = await api('shop-order', { product_id: productId, quantity: 2, choices: {} });
  assert.equal(order.order.total, 198);
  assert.equal(order.order.payment_status, 'unpaid');

  const published = await api('publish-announcement', { title: 'ประกาศทดสอบ', body: 'เนื้อหาทดลอง', show_on_entry: false });
  assert.equal(published.simulated, true);
  const announcements = await api('announcements-list');
  assert.equal(announcements.announcements[0].title, 'ประกาศทดสอบ');

  await api('announcement-entry-setting', { id: published.announcement.id, show_on_entry: true });
  const changed = await api('announcements-list');
  assert.equal(changed.announcements[0].show_on_entry, true);

  await assert.rejects(api('production-write', {}), /ไม่มีตัวจำลอง/);
  dom.window.close();
}

(async () => {
  await testNetworkBoundary();
  await testMockApi();
  console.log('Offline Sandbox network isolation and mock API tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
