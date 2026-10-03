import {createRequire} from 'node:module';
import {gzipSync} from 'node:zlib';
import {expect,it,vi} from 'vitest';
import {initializeCloudflareV1} from './cloudflare-v1-upload';
import {readCloudflareMetric,type SqlStore} from './cloudflare-store';
const context=vi.hoisted(()=>({sql:undefined as unknown}));
vi.mock('@opennextjs/cloudflare',()=>({getCloudflareContext:()=>({env:{FRONTPAGE_SQL:context.sql}})}));
it('reports mismatched legacy pairs unavailable and reads a coherent pair',()=>{
 const {DatabaseSync}=createRequire(import.meta.url)('node:sqlite'),db=new DatabaseSync(':memory:');
 const sql:SqlStore={exec:(query,...bindings)=>{const rows=db.prepare(query).all(...bindings);return{toArray:()=>rows};}};
 initializeCloudflareV1(sql);context.sql=sql;vi.stubEnv('FRONTPAGE_CLOUDFLARE','1');
 const snapshot=(collected_at:string)=>({schema_version:1,collected_at,host:{cpu_percent:1,ram_used_bytes:1,ram_total_bytes:2,disk_used_bytes:1,disk_total_bytes:2,load_1m:1,load_5m:1,load_15m:1,uptime_seconds:1},services:[],containers:[]});
 const latest=snapshot('2026-10-03T13:01:00Z'),older=snapshot('2026-10-03T13:00:00Z');
 try{
  sql.exec('INSERT INTO metrics_snapshot(name,data) VALUES(?,?)','latest.json',gzipSync(JSON.stringify(latest)));
  sql.exec('INSERT INTO metrics_snapshot(name,data) VALUES(?,?)','history.json',gzipSync(JSON.stringify({schema_version:1,samples:[older]})));
  expect(()=>readCloudflareMetric('latest.json')).toThrow('disagree');expect(()=>readCloudflareMetric('history.json')).toThrow('disagree');
  sql.exec('UPDATE metrics_snapshot SET data=? WHERE name=?',gzipSync(JSON.stringify({schema_version:1,samples:[older,latest]})),'history.json');
  expect(readCloudflareMetric('latest.json')).toEqual(latest);expect(readCloudflareMetric('history.json')).toEqual({schema_version:1,samples:[older,latest]});
 }finally{vi.unstubAllEnvs();db.close();}
});
