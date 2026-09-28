import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

test('lead queues expose an accessible tab relationship', () => {
  assert.match(html, /class="queue-tabs"[^>]*role="tablist"/);
  assert.match(html, /id="untouchedTab"[^>]*role="tab"[^>]*aria-selected="true"[^>]*aria-controls="queuePanel"/);
  assert.match(html, /id="touchedTab"[^>]*role="tab"[^>]*aria-selected="false"[^>]*aria-controls="queuePanel"/);
  assert.match(html, /id="queuePanel"[^>]*role="tabpanel"[^>]*aria-labelledby="untouchedTab"/);
});

test('queue selection keeps visual and accessibility state synchronized', () => {
  assert.match(app, /setAttribute\('aria-selected',String\(selected\)\)/);
  assert.match(app, /item\.tabIndex=selected\?0:-1/);
  assert.match(app, /queuePanel\.setAttribute\('aria-labelledby',tab\.id\)/);
  assert.match(app, /\['ArrowRight','ArrowLeft','Home','End'\]|event\.key==='ArrowRight'/);
  assert.match(app, /selectTab\(\$\('touchedTab'\)\)/);
});
