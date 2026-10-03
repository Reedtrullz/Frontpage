import fs from 'node:fs';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {z} from 'zod';
import {personalDraftSchema, projectsDraftSchema, legacyPersonalDraftSchema, legacyProjectsDraftSchema, publishReceiptSchema, withOwnerStateLock} from './drafts';
import {parseProjects} from './schema';
import {publicationJournalSchema} from './publication-intents';

export const OWNER_BACKUP_CAP = 8 * 1024 * 1024;
const schemas = {
  'drafts/personal.json': z.union([personalDraftSchema, legacyPersonalDraftSchema]),
  'drafts/projects.json': z.union([projectsDraftSchema, legacyProjectsDraftSchema]),
  'receipts/publication.json': publishReceiptSchema,
  'receipts/publication-intents.json': publicationJournalSchema,
};
const envelope = z.object({
  schemaVersion: z.literal(1), backupId: z.string().uuid(), createdAt: z.string().datetime(),
  source: z.object({kind:z.enum(['file','cloudflare']),target:z.string().min(1).max(1024)}).strict(),
  sha256:z.string().regex(/^[a-f0-9]{64}$/),
  records:z.array(z.object({key:z.enum(Object.keys(schemas) as [keyof typeof schemas,...Array<keyof typeof schemas>]),value:z.unknown()}).strict()).max(4),
}).strict();
export type OwnerBackup = z.infer<typeof envelope>;
type RecordInput = {key:string;value:unknown};
type Sql = {exec(query:string,...bindings:string[]):{toArray():Record<string,unknown>[]}};
type Storage = {sql:Sql;transactionSync<T>(action:()=>T):T};
const digest = (records:unknown)=>createHash('sha256').update(JSON.stringify(records)).digest('hex');

export function validateOwnerBackup(input:unknown):OwnerBackup {
  if (Buffer.byteLength(JSON.stringify(input) ?? '') > OWNER_BACKUP_CAP) throw new Error('Owner backup exceeds its size cap.');
  const backup=envelope.parse(input);
  const {sha256,...manifest}=backup;
  if (digest(manifest)!==sha256) throw new Error('Owner backup integrity check failed.');
  if (new Set(backup.records.map(record=>record.key)).size!==backup.records.length) throw new Error('Duplicate owner record.');
  for (const record of backup.records) {
    const parsed=schemas[record.key].parse(record.value);
    if(record.key==='drafts/projects.json' && 'content' in parsed)parseProjects(parsed.content);
  }
  return backup;
}
export function createOwnerBackup(records:RecordInput[],source:OwnerBackup['source']):OwnerBackup {
  const manifest={schemaVersion:1,backupId:randomUUID(),createdAt:new Date().toISOString(),source,records};
  return validateOwnerBackup({...manifest,sha256:digest(manifest)});
}
export function exportFileOwnerState(dataDir:string):OwnerBackup {
  if(fs.lstatSync(dataDir).isSymbolicLink())throw new Error('Owner data root must not be a symlink.');
  return withOwnerStateLock(dataDir,()=>{
    const records:RecordInput[]=[];
    for(const key of Object.keys(schemas).sort()) {
      const file=path.join(dataDir,key);
      if(!fs.existsSync(file))continue;
      if(fs.lstatSync(path.dirname(file)).isSymbolicLink())throw new Error('Owner record directory must not be a symlink.');
      const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
      try{
        const stat=fs.fstatSync(fd);if(!stat.isFile() || stat.size>OWNER_BACKUP_CAP)throw new Error('Invalid owner record size or type.');
        const raw=Buffer.alloc(stat.size);let read=0;
        while(read<raw.length){const count=fs.readSync(fd,raw,read,raw.length-read,null);if(count===0)throw new Error('Truncated owner record.');read+=count;}
        records.push({key,value:JSON.parse(raw.toString('utf8'))});
      }finally{fs.closeSync(fd);}
    }
    return createOwnerBackup(records,{kind:'file',target:path.resolve(dataDir)});
  });
}
function confirm(backup:OwnerBackup,target:string,confirmation:{backupId:string;target:string}):void {
  if(confirmation.backupId!==backup.backupId || confirmation.target!==target)throw new Error('Explicit backup and destination confirmation is required.');
}
export function restoreFileOwnerState(input:unknown,target:string,confirmation:{backupId:string;target:string}):void {
  const backup=validateOwnerBackup(input);confirm(backup,target,confirmation);
  if(fs.existsSync(target))throw new Error('Restore requires a fresh destination.');
  const staging=path.join(path.dirname(path.resolve(target)),'.frontpage-restore-'+randomUUID());
  fs.mkdirSync(staging,{mode:0o700});
  try {
    for(const record of backup.records){const file=path.join(staging,record.key);fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(file,JSON.stringify(record.value)+'\n',{mode:0o600,flag:'wx'});}
    if(JSON.stringify(exportFileOwnerState(staging).records)!==JSON.stringify(backup.records))throw new Error('Restore readback failed.');
    fs.renameSync(staging,target);
  } finally {fs.rmSync(staging,{recursive:true,force:true});}
}
export function exportSqlOwnerState(sql:Sql,target:string):OwnerBackup {
  sql.exec('CREATE TABLE IF NOT EXISTS owner_state(key TEXT PRIMARY KEY,value TEXT NOT NULL)');
  const records=sql.exec('SELECT key,value FROM owner_state ORDER BY key').toArray().map(row=>({key:String(row.key),value:JSON.parse(String(row.value))}));
  return createOwnerBackup(records,{kind:'cloudflare',target});
}
export function restoreSqlOwnerState(input:unknown,storage:Storage,target:string,confirmation:{backupId:string;target:string}):void {
  const backup=validateOwnerBackup(input);confirm(backup,target,confirmation);
  storage.transactionSync(()=>{
    storage.sql.exec('CREATE TABLE IF NOT EXISTS owner_state(key TEXT PRIMARY KEY,value TEXT NOT NULL)');
    storage.sql.exec('DELETE FROM owner_state');
    for(const record of backup.records)storage.sql.exec('INSERT INTO owner_state(key,value) VALUES(?,?)',record.key,JSON.stringify(record.value));
  });
}
