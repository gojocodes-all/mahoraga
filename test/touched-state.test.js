import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const instrumentedSource = source.replace(
  /\}\)\(\);\s*$/,
  'globalThis.__test={state,els,markActiveTouched};})();',
);

function createElement() {
  const listeners = new Map();

  return {
    addEventListener(type, listener) { listeners.set(type, listener); },
    classList: { add() {}, remove() {}, toggle() {} },
    dispatch(type, event = {}) { return listeners.get(type)?.(event); },
    setAttribute() {},
    style: {},
    value: '',
  };
}

function loadApp({ saved = '{}', failWrites = false } = {}) {
  const elements = new Map();
  const writes = [];
  const timers = [];
  const context = {
    document: {
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, createElement());
        return elements.get(id);
      },
      querySelectorAll() { return []; },
    },
    localStorage: {
      getItem() { return saved; },
      setItem(key, value) {
        if (failWrites) throw new Error('storage unavailable');
        writes.push([key, value]);
      },
    },
    setTimeout(callback, delay) {
      timers.push({ callback, delay });
      return timers.length;
    },
    clearTimeout() {},
  };

  vm.runInNewContext(instrumentedSource, context);
  return { ...context.__test, timers, writes };
}

test('ignores valid JSON that is not a touched-lead dictionary', () => {
  for (const saved of ['null', '[]', '"lead"', '42']) {
    const { state } = loadApp({ saved });
    assert.equal(Object.keys(state.touched).length, 0);
  }
});

test('keeps the WhatsApp handoff usable when touched-state persistence fails', () => {
  const { els, state, timers, writes, markActiveTouched } = loadApp({ failWrites: true });
  state.active = { id: 'lead-1', title: 'Ada Cafe', phone: '0801 234 5678' };
  els.message.value = 'Hello Ada Cafe';

  assert.doesNotThrow(() => markActiveTouched({ preventDefault() {
    assert.fail('A lead with a phone number should keep its WhatsApp handoff');
  } }));

  assert.equal(state.touched['lead-1'].name, 'Ada Cafe');
  assert.equal(state.touched['lead-1'].phone, '0801 234 5678');
  assert.equal(
    els.wa.href,
    'https://wa.me/2348012345678?text=Hello%20Ada%20Cafe',
  );
  assert.equal(writes.length, 0);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 120);
});

test('persists touched leads under the existing storage key when available', () => {
  const { els, state, writes, markActiveTouched } = loadApp();
  state.active = { id: 'lead-2', title: 'Kemi Stores', phone: '+234 802 000 0000' };
  els.message.value = 'Hello Kemi Stores';

  markActiveTouched({ preventDefault() {} });

  assert.equal(writes.length, 1);
  assert.equal(writes[0][0], 'mahoraga:touched');
  assert.equal(JSON.parse(writes[0][1])['lead-2'].name, 'Kemi Stores');
});
