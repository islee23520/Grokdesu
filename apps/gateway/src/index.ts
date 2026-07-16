import {serve} from '@hono/node-server';
import {mkdirSync, readFileSync, writeFileSync, chmodSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {assertSafeBind, createGateway, issuePairingCode} from './app';
import {registry} from './providers';
const host=process.env.OMONATIVE_HOST??'127.0.0.1'; assertSafeBind(host); const port=Number(process.env.PORT??8787); const dbPath=process.env.OMONATIVE_DB_PATH??'omonative-control.sqlite';
if(process.argv[2]==='pair'){console.log(issuePairingCode(dbPath));process.exit(0);}
function cursorSecret(){if(process.env.OMONATIVE_CURSOR_SECRET)return process.env.OMONATIVE_CURSOR_SECRET;if(process.env.NODE_ENV==='production')throw new Error('OMONATIVE_CURSOR_SECRET is required in production');const file=resolve(`${dbPath}.cursor-secret`);try{return readFileSync(file,'utf8').trim();}catch{mkdirSync(dirname(file),{recursive:true});const value=Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');writeFileSync(file,value,{mode:0o600});chmodSync(file,0o600);return value;}}
const staticRoot=process.env.OMONATIVE_STATIC_ROOT===undefined ? new URL('../../web/dist',import.meta.url).pathname : process.env.OMONATIVE_STATIC_ROOT || undefined;
const app=createGateway({secret:cursorSecret(),dbPath,staticRoot,peerLoopback:()=>false});
const server=serve({fetch:app.fetch,hostname:host,port});
let stopping=false;
async function shutdown(signal:string){if(stopping)return;stopping=true;console.log(`omonative stopping (${signal})`);server.close();const closers=[...registry().values()].map(provider=>typeof (provider as any).close==='function'?(provider as any).close():undefined);await Promise.allSettled(closers);process.exit(0);}
process.once('SIGTERM',()=>void shutdown('SIGTERM'));process.once('SIGINT',()=>void shutdown('SIGINT'));
console.log(`omonative listening on http://${host}:${port}`);
