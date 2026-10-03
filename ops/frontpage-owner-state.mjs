#!/usr/bin/env node
import fs from 'node:fs';
import {parseArgs} from 'node:util';
import {restoreRemoteOwnerState,UnknownRestoreOutcomeError} from './owner-state-transport.mjs';
import {OWNER_BACKUP_CAP, validateOwnerBackup, exportFileOwnerState, restoreFileOwnerState} from '../src/lib/content/owner-state-backup';
const {values}=parseArgs({options:Object.fromEntries(['mode','action','data-dir','endpoint','backup','target','confirm-target','confirm-backup','expected-operator-host','maintenance-secret-file','access-client-id-file','access-client-secret-file'].map(name=>[name,{type:'string'}]))});
function required(name){const value=values[name];if(!value)throw new Error('Required option: --'+name);return value;}
function boundedFile(file,cap){const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const stat=fs.fstatSync(fd);if(!stat.isFile()||stat.size>cap)throw new Error('Invalid file type or size');const result=Buffer.alloc(stat.size);let offset=0;while(offset<result.length){const read=fs.readSync(fd,result,offset,result.length-offset,null);if(!read)throw new Error('Truncated file');offset+=read;}return result;}finally{fs.closeSync(fd);}}
const readBackup=()=>validateOwnerBackup(JSON.parse(boundedFile(required('backup'),OWNER_BACKUP_CAP).toString('utf8')));
async function remote(method,backup){
 const endpoint=new URL(required('endpoint'));
 if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||endpoint.search||endpoint.hash||endpoint.hostname!==required('expected-operator-host')||['reidar.tech','www.reidar.tech'].includes(endpoint.hostname)||endpoint.pathname!=='/__operator/owner-state')throw new Error('An explicit, dedicated HTTPS operator endpoint is required.');
 const readSecret=name=>boundedFile(required(name),16*1024).toString('utf8').trim();
 const headers={Authorization:'Bearer '+readSecret('maintenance-secret-file'),'CF-Access-Client-Id':readSecret('access-client-id-file'),'CF-Access-Client-Secret':readSecret('access-client-secret-file')};
 if(backup){headers['content-type']='application/json';headers['X-Frontpage-Restore-Target']=required('confirm-target');headers['X-Frontpage-Backup-ID']=required('confirm-backup');}
 const response=await fetch(endpoint,{method,headers,body:backup?JSON.stringify(backup):undefined,redirect:'error',signal:AbortSignal.timeout(15000)});
 if(!response.ok){await response.body?.cancel();throw new Error('Operator request failed with HTTP '+response.status);}
 const reader=response.body?.getReader();const chunks=[];let size=0;
 try{if(reader)for(;;){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>OWNER_BACKUP_CAP){await reader.cancel();throw new Error('Operator response exceeds cap');}chunks.push(next.value);}}finally{reader?.releaseLock();}
 return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
try{
 const mode=required('mode'),action=required('action');if(!['file','cloudflare'].includes(mode)||!['export','restore','verify'].includes(action))throw new Error('Invalid mode or action');
 if(action==='verify'){const backup=readBackup();console.log(JSON.stringify({verified:true,backupId:backup.backupId,records:backup.records.length}));}
 else if(action==='export'){
  const backup=mode==='file'?exportFileOwnerState(required('data-dir')):validateOwnerBackup(await remote('GET'));
  if(mode==='cloudflare'&&backup.source.target!==required('target'))throw new Error('Export target identity mismatch');
  fs.writeFileSync(required('backup'),JSON.stringify(backup)+'\n',{mode:0o600,flag:'wx'});console.log(JSON.stringify({exported:true,backupId:backup.backupId,sha256:backup.sha256,records:backup.records.length}));
 }else{
  const backup=readBackup(),target=mode==='file'?required('data-dir'):required('target');
  if(required('confirm-target')!==target||required('confirm-backup')!==backup.backupId)throw new Error('Backup and destination confirmation mismatch');
  let recovery;
  if(mode==='file')restoreFileOwnerState(backup,target,{target,backupId:backup.backupId});else recovery=await restoreRemoteOwnerState({backup,target,put:input=>remote('PUT',input),read:()=>remote('GET'),validate:validateOwnerBackup});
  console.log(JSON.stringify({restored:true,backupId:backup.backupId,...recovery}));
 }
}catch(error){if(error instanceof UnknownRestoreOutcomeError){console.error(error.message);process.exitCode=2;}else{console.error('Owner-state operation failed. Check options, private file access, target confirmation, and operator configuration. No private record values are printed.');process.exitCode=1;}}
