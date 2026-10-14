import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { app } from '../src/app.js';

let baseUrl;
let server;

before(async()=>{
  server=app.listen(0,'127.0.0.1');
  await once(server,'listening');
  const address=server.address();
  baseUrl=`http://127.0.0.1:${address.port}`;
});

after(async()=>{
  if(!server)return;
  server.close();
  await once(server,'close');
});

test('health endpoint reports the service contract with security headers',async()=>{
  const response=await fetch(`${baseUrl}/api/health`);
  const body=await response.json();

  assert.equal(response.status,200);
  assert.equal(body.ok,true);
  assert.equal(body.name,'Mahoraga');
  assert.match(body.searchProvider,/SearXNG|DuckDuckGo/);
  assert.equal(response.headers.get('x-powered-by'),null);
  assert.equal(response.headers.get('x-content-type-options'),'nosniff');
});

test('job lookup returns the documented JSON error for an unknown job',async()=>{
  const response=await fetch(`${baseUrl}/api/jobs/missing`);

  assert.equal(response.status,404);
  assert.match(response.headers.get('content-type'),/^application\/json/);
  assert.deepEqual(await response.json(),{error:'Search job not found or expired.'});
});

test('malformed API JSON is rejected with a stable JSON response',async()=>{
  const response=await fetch(`${baseUrl}/api/jobs`,{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:'{"query":'
  });

  assert.equal(response.status,400);
  assert.match(response.headers.get('content-type'),/^application\/json/);
  assert.deepEqual(await response.json(),{error:'Request body must be valid JSON.'});
});

test('unknown API routes return JSON instead of an HTML fallback',async()=>{
  const response=await fetch(`${baseUrl}/api/not-a-route`);

  assert.equal(response.status,404);
  assert.match(response.headers.get('content-type'),/^application\/json/);
  assert.deepEqual(await response.json(),{error:'API route not found.'});
});
