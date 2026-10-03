import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {parseMetricsSnapshot,parseMetricsHistory} from './schema';
import type {SqlStore} from './cloudflare-store';
type Storage={sql:SqlStore;transactionSync<T>(callback:()=>T):T};
const caps:Record<string,number>={'latest.json':512*1024,'history.json':4*1024*1024};
export function initializeCloudflareV1(sql:SqlStore):void {
 sql.exec('CREATE TABLE IF NOT EXISTS metrics_snapshot (name TEXT PRIMARY KEY,data BLOB NOT NULL)');
 sql.exec('CREATE TABLE IF NOT EXISTS metrics_v1_stage (generation TEXT NOT NULL,name TEXT NOT NULL,data BLOB NOT NULL,uploaded_at INTEGER NOT NULL,PRIMARY KEY(generation,name))');
 sql.exec('CREATE TABLE IF NOT EXISTS metrics_v1_generations (generation TEXT PRIMARY KEY,collected_at TEXT NOT NULL,latest BLOB NOT NULL,history BLOB NOT NULL)');
 sql.exec('CREATE TABLE IF NOT EXISTS metrics_v1_active (id INTEGER PRIMARY KEY CHECK(id=1),generation TEXT NOT NULL)');
}
async function readBounded(request:Request):Promise<Uint8Array> {
 const reader=request.body?.getReader();if(!reader)throw new Error('Missing body');const chunks:Uint8Array[]=[];let total=0;
 try{for(;;){const next=await reader.read();if(next.done)break;total+=next.value.byteLength;if(total>1024*1024){await reader.cancel();throw new RangeError('Payload too large');}chunks.push(next.value);}}finally{reader.releaseLock();}
 if(!total)throw new Error('Empty body');return Buffer.concat(chunks);
}
function decoded(name:string,bytes:Uint8Array,now:number){
 const raw=gunzipSync(bytes,{maxOutputLength:caps[name]});const json:unknown=JSON.parse(raw.toString('utf8'));
 const data=name==='latest.json'?parseMetricsSnapshot(json):parseMetricsHistory(json);
 const samples='samples' in data?data.samples:[data];let previous=-Infinity;
 for(const sample of samples){const time=Date.parse(sample.collected_at);if(time>now || time<=previous)throw new Error('Invalid snapshot order/time');previous=time;for(const service of sample.services)if(Date.parse(service.checked_at)>now)throw new Error('Future check');}
 if(!samples.length)throw new Error('Empty history');return{raw,data,time:samples.at(-1)!.collected_at};
}
export async function uploadCloudflareV1(request:Request,storage:Storage,name:string,now=Date.now()):Promise<Response> {
 const {sql}=storage;initializeCloudflareV1(sql);const generation=request.headers.get('X-Frontpage-Generation');
 if(generation!==null && !/^[a-f0-9]{64}$/.test(generation))return new Response('Invalid generation',{status:400});
 try {
  if(name==='v1/commit'){
   if(!generation)throw new Error('Missing generation');
   storage.transactionSync(()=>{
    const active=sql.exec('SELECT generation FROM metrics_v1_active WHERE id=1').toArray()[0];if(active?.generation===generation)return;
    const rows=sql.exec('SELECT name,data FROM metrics_v1_stage WHERE generation=?',generation).toArray();
    const latestBytes=rows.find(r=>r.name==='latest.json')?.data as Uint8Array|undefined,historyBytes=rows.find(r=>r.name==='history.json')?.data as Uint8Array|undefined;
    if(!latestBytes || !historyBytes)throw new Error('Incomplete generation');
    const latest=decoded('latest.json',latestBytes,now),history=decoded('history.json',historyBytes,now);
    if(!('samples' in history.data) || 'samples' in latest.data || JSON.stringify(history.data.samples.at(-1))!==JSON.stringify(latest.data))throw new Error('Inconsistent pair');
    const hash=createHash('sha256').update(latest.raw).update('\0').update(history.raw).digest('hex');if(hash!==generation)throw new Error('Generation digest mismatch');
    const previous=sql.exec('SELECT collected_at FROM metrics_v1_generations WHERE generation=(SELECT generation FROM metrics_v1_active WHERE id=1)').toArray()[0];if(previous && Date.parse(String(previous.collected_at))>=Date.parse(latest.time))throw new Error('Replay');
    sql.exec('INSERT INTO metrics_v1_generations(generation,collected_at,latest,history) VALUES(?,?,?,?)',generation,latest.time,latestBytes,historyBytes);
    sql.exec('INSERT INTO metrics_v1_active(id,generation) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET generation=excluded.generation',generation);
    sql.exec('DELETE FROM metrics_v1_stage WHERE generation=?',generation);
    sql.exec('DELETE FROM metrics_v1_generations WHERE generation NOT IN (SELECT generation FROM metrics_v1_generations ORDER BY collected_at DESC LIMIT 2)');
   });return new Response(null,{status:204});
  }
  if(!caps[name])return new Response('Not found',{status:404});
  const bytes=await readBounded(request);const incoming=decoded(name,bytes,now);
  if(generation){
   storage.transactionSync(()=>{
    sql.exec('DELETE FROM metrics_v1_stage WHERE uploaded_at<?',now-10*60*1000);
    const generations=sql.exec('SELECT DISTINCT generation FROM metrics_v1_stage').toArray();if(!generations.some(r=>r.generation===generation) && generations.length>=2)throw new Error('Staging is full');
    const existing=sql.exec('SELECT data FROM metrics_v1_stage WHERE generation=? AND name=?',generation,name).toArray()[0];if(existing && !Buffer.from(existing.data as Uint8Array).equals(bytes))throw new Error('Generation member changed');
    sql.exec('INSERT INTO metrics_v1_stage(generation,name,data,uploaded_at) VALUES(?,?,?,?) ON CONFLICT(generation,name) DO UPDATE SET uploaded_at=excluded.uploaded_at',generation,name,bytes,now);
   });return new Response(null,{status:204});
  }
  if(sql.exec('SELECT generation FROM metrics_v1_active WHERE id=1').toArray().length)return new Response('A coherent generation is required',{status:409});
  const previous=sql.exec('SELECT data FROM metrics_snapshot WHERE name=?',name).toArray()[0];
  if(previous){const old=decoded(name,previous.data as Uint8Array,now);if(Date.parse(incoming.time)<Date.parse(old.time) || (incoming.time===old.time && !incoming.raw.equals(old.raw)))throw new Error('Replay');}
  sql.exec('INSERT INTO metrics_snapshot(name,data) VALUES(?,?) ON CONFLICT(name) DO UPDATE SET data=excluded.data',name,bytes);
  return new Response(null,{status:204});
 }catch(error){return new Response(error instanceof RangeError?'Payload too large':'Invalid snapshot',{status:error instanceof RangeError?413:400});}
}
