export type Scope = 'metadata:read' | 'transcript:read' | 'session:create' | 'session:send' | 'session:cancel' | 'token:manage';
export const scopes: Scope[] = ['metadata:read','transcript:read','session:create','session:send','session:cancel','token:manage'];
export type ProviderId = 'senpi' | 'grok';
export type Session = { id:string; provider:ProviderId; projectId:string; title:string; generation:number; updatedAt:string; status:'idle'|'streaming'|'cancelled' };
export type TranscriptEvent = { id:number; type:'message'|'complete'|'cancelled'; role?:'user'|'assistant'; text?:string; generation:number; at:string };
export type ApiError = { error:{ code:string; message:string } };
export const error = (code:string, message:string): ApiError => ({error:{code,message}});
const enc = new TextEncoder();
const b64 = (data:Uint8Array) => Buffer.from(data).toString('base64url');
const unb64 = (value:string) => new Uint8Array(Buffer.from(value,'base64url'));
export async function signCursor(payload:{sessionId:string; after:number; provider?:ProviderId; generation?:number}, secret:string):Promise<string> { const body=b64(enc.encode(JSON.stringify(payload))); const key=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']); const sig=b64(new Uint8Array(await crypto.subtle.sign('HMAC',key,enc.encode(body)))); return `${body}.${sig}`; }
export async function verifyCursor(cursor:string, secret:string):Promise<{sessionId:string;after:number;provider?:ProviderId;generation?:number}|null> { const [body,sig,...extra]=cursor.split('.'); if(!body||!sig||extra.length)return null; const key=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']); if(!await crypto.subtle.verify('HMAC',key,unb64(sig),enc.encode(body)))return null; try { const value=JSON.parse(new TextDecoder().decode(unb64(body))); return typeof value.sessionId==='string'&&Number.isInteger(value.after)&&value.after>=0?value:null; } catch{return null;} }
export function parseSse(source:string):Array<{event:string;data:string}> { return source.trim().split(/\n\n+/).filter(Boolean).map(block=>{const lines=block.split('\n'); return {event:lines.find(x=>x.startsWith('event:'))?.slice(6).trim()??'message',data:lines.filter(x=>x.startsWith('data:')).map(x=>x.slice(5).trim()).join('\n')};}); }
