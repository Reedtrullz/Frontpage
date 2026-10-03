import {createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey} from 'jose';
import {timingSafeEqual} from 'node:crypto';
import {exportSqlOwnerState, restoreSqlOwnerState, OWNER_BACKUP_CAP} from './owner-state-backup';
type Env={OWNER_OPERATOR_HOST?:string;OWNER_MAINTENANCE_SECRET?:string;OWNER_ACCESS_TEAM?:string;OWNER_ACCESS_AUD?:string;OWNER_ACCESS_SERVICE_ID?:string;OWNER_RESTORE_ENABLED?:string;OWNER_STATE_TARGET?:string};
type Storage=Parameters<typeof restoreSqlOwnerState>[1];
const privateHeaders={'Cache-Control':'private, no-store','Content-Type':'application/json'};
const response=(status:number,message:string)=>new Response(JSON.stringify({message}),{status,headers:privateHeaders});
export async function authorizeOwnerMaintenance(request:Request,env:Env,key?:JWTVerifyGetKey):Promise<boolean> {
 const host=env.OWNER_OPERATOR_HOST;
 if(!host || ['reidar.tech','www.reidar.tech'].includes(host) || host.endsWith('.workers.dev') || new URL(request.url).hostname!==host || !/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.OWNER_ACCESS_TEAM ?? '') || !env.OWNER_ACCESS_AUD || !env.OWNER_MAINTENANCE_SECRET)return false;
 const token=request.headers.get('Authorization')?.replace(/^Bearer /,'') ?? '';
 const expected=Buffer.from(env.OWNER_MAINTENANCE_SECRET),received=Buffer.from(token);
 if(!expected.length || expected.length!==received.length || !timingSafeEqual(expected,received))return false;
 const assertion=request.headers.get('Cf-Access-Jwt-Assertion');if(!assertion)return false;
 try{
  const issuer='https://'+env.OWNER_ACCESS_TEAM;
  const {payload}=await jwtVerify(assertion,key ?? createRemoteJWKSet(new URL(issuer+'/cdn-cgi/access/certs'),{timeoutDuration:5000}),{issuer,audience:env.OWNER_ACCESS_AUD,algorithms:['RS256'],requiredClaims:['exp','iat','sub']});
  return payload.type==='app' && ((typeof payload.sub==='string' && payload.sub.length>0) || (payload.sub==='' && typeof env.OWNER_ACCESS_SERVICE_ID==='string' && env.OWNER_ACCESS_SERVICE_ID.length>0 && payload.common_name===env.OWNER_ACCESS_SERVICE_ID));
 }catch{return false;}
}
async function body(request:Request):Promise<unknown>{
 const reader=request.body?.getReader();if(!reader)throw new Error('Missing backup');const chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>OWNER_BACKUP_CAP){await reader.cancel();throw new Error('Oversize backup');}chunks.push(next.value);}}
 finally{reader.releaseLock();}
 return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export async function handleOwnerMaintenance(request:Request,env:Env,storage:Storage):Promise<Response>{
 if(!await authorizeOwnerMaintenance(request,env)){await request.body?.cancel();return response(404,'Not found');}
 const target=env.OWNER_STATE_TARGET;if(!target)return response(503,'Operator target is not configured.');
 try{
  if(request.method==='GET')return new Response(JSON.stringify(exportSqlOwnerState(storage.sql,target)),{headers:privateHeaders});
  if(request.method==='PUT'){
   if(env.OWNER_RESTORE_ENABLED!=='1'){await request.body?.cancel();return response(403,'Restore is disabled.');}
   if(!request.headers.get('content-type')?.startsWith('application/json'))return response(415,'JSON backup is required.');
   restoreSqlOwnerState(await body(request),storage,target,{target:request.headers.get('X-Frontpage-Restore-Target') ?? '',backupId:request.headers.get('X-Frontpage-Backup-ID') ?? ''});
   return response(200,'Owner state restored. Verify readback before enabling writes.');
  }
  return response(405,'Method not allowed');
 }catch{return response(400,'Owner state validation or persistence failed.');}
}
