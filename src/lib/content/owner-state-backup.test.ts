import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {afterEach, expect, it} from 'vitest';
import {getCanonicalProjects} from './index';
import {saveProjectsDraft, readDraftBundle} from './drafts';
import {createOwnerBackup, validateOwnerBackup, exportFileOwnerState, restoreFileOwnerState, exportSqlOwnerState, restoreSqlOwnerState} from './owner-state-backup';
const dirs:string[]=[];
afterEach(()=>dirs.splice(0).forEach(dir=>fs.rmSync(dir,{recursive:true,force:true})));
it('rehearses exact private file export to a fresh destination and rejects corruption before creating it',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'frontpage-owner-restore-'));dirs.push(root);
 const source=path.join(root,'source'), target=path.join(root,'restored');
 const draft=saveProjectsDraft(getCanonicalProjects(),{dataDir:source,baseVersion:'a'.repeat(40)});
 const backup=exportFileOwnerState(source);restoreFileOwnerState(backup,target,{backupId:backup.backupId,target});
 expect(readDraftBundle(target).projects).toEqual(draft);
 const corrupt=structuredClone(backup);corrupt.records[0].value={};
 expect(()=>restoreFileOwnerState(corrupt,path.join(root,'corrupt'),{backupId:backup.backupId,target:path.join(root,'corrupt')})).toThrow();
 expect(fs.existsSync(path.join(root,'corrupt'))).toBe(false);
 expect(()=>restoreFileOwnerState(backup,target,{backupId:backup.backupId,target})).toThrow();
 expect(()=>validateOwnerBackup({...backup,schemaVersion:99})).toThrow();
});
it('validates all SQL records before a transactional replacement and preserves revisions',()=>{
 const {DatabaseSync}=createRequire(import.meta.url)('node:sqlite');const db=new DatabaseSync(':memory:');
 const storage={sql:{exec:(query:string,...bindings:unknown[])=>{const rows=db.prepare(query).all(...bindings);return{toArray:()=>rows};}},transactionSync<T>(action:()=>T){db.exec('BEGIN');try{const result=action();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}}};
 try{db.exec('CREATE TABLE owner_state(key TEXT PRIMARY KEY,value TEXT NOT NULL)');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'frontpage-backup-sql-'));dirs.push(root);saveProjectsDraft(getCanonicalProjects(),{dataDir:root,baseVersion:'a'.repeat(40)});
 const fileBackup=exportFileOwnerState(root);restoreSqlOwnerState(fileBackup,storage,'isolated-sql',{backupId:fileBackup.backupId,target:'isolated-sql'});
 expect(exportSqlOwnerState(storage.sql,'isolated-sql').records).toEqual(fileBackup.records);
 expect(()=>createOwnerBackup([{key:'receipts/publication.json',value:{kind:'secret'}}],{kind:'cloudflare',target:'isolated-sql'})).toThrow();
 expect(exportSqlOwnerState(storage.sql,'isolated-sql').records).toEqual(fileBackup.records);
 }finally{db.close();}
});
