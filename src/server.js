import { app } from './app.js';

const DEFAULT_PORT = 3000;
const SHUTDOWN_TIMEOUT_MS = 10_000;
const port = parsePort(process.env.PORT);
const server = app.listen(port,()=>{
  console.log(`Mahoraga listening on :${port}`);
});

let shuttingDown = false;

for(const signal of ['SIGINT','SIGTERM']){
  process.once(signal,()=>shutdown(signal));
}

server.on('error',err=>{
  console.error('Mahoraga server error:',err);
  process.exitCode=1;
});

function shutdown(signal){
  if(shuttingDown)return;
  shuttingDown=true;
  console.log(`${signal} received; closing Mahoraga.`);

  const timeout=setTimeout(()=>{
    console.error('Mahoraga shutdown timed out; closing active connections.');
    server.closeAllConnections?.();
    process.exitCode=1;
  },SHUTDOWN_TIMEOUT_MS);
  timeout.unref();

  server.close(err=>{
    clearTimeout(timeout);
    if(err){
      console.error('Mahoraga shutdown failed:',err);
      process.exitCode=1;
    }
  });
}

function parsePort(value){
  const candidate=value===undefined||value===''?DEFAULT_PORT:Number(value);
  if(!Number.isInteger(candidate)||candidate<0||candidate>65_535){
    throw new TypeError('PORT must be an integer from 0 to 65535.');
  }
  return candidate;
}
