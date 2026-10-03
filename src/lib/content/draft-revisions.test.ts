import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {afterEach, expect, it, vi} from 'vitest';
const context=vi.hoisted(()=>({env:{}}));
vi.mock('@opennextjs/cloudflare',()=>({getCloudflareContext:()=>context}));
import {getCanonicalProjects,getCanonicalPersonal} from './index';
import {saveProjectsDraft,savePersonalDraft,readDraftBundle,clearDrafts,discardProjectsDraft} from './drafts';
const dirs:string[]=[];
const closes:Array<()=>void>=[];
afterEach(()=>{delete process.env.FRONTPAGE_CLOUDFLARE;context.env={};dirs.splice(0).forEach(p=>fs.rmSync(p,{recursive:true,force:true}));closes.splice(0).forEach(f=>f());});
function options(sql:boolean){
 if(sql){const {DatabaseSync}=createRequire(import.meta.url)('node:sqlite'); const db=new DatabaseSync(':memory:');closes.push(()=>db.close());context.env={FRONTPAGE_SQL:{exec:(query:string,...values:string[])=>{const rows=db.prepare(query).all(...values);return {toArray:()=>rows};}}};process.env.FRONTPAGE_CLOUDFLARE='1';return {baseVersion:'a'.repeat(40)};}
 const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'frontpage-cas-'));dirs.push(dataDir);return {dataDir,baseVersion:'a'.repeat(40)};
}
for(const sql of [false,true])it(`preserves stale-tab and save-during-publish drafts (${sql?'SQL':'files'})`,()=>{
 const opts=options(sql);const first=saveProjectsDraft(getCanonicalProjects(),{...opts,expectedRevision:null});
 const next=getCanonicalProjects();next[0].shortDescription='Newer draft';
 const second=saveProjectsDraft(next,{...opts,expectedRevision:first.revision});
 expect(()=>saveProjectsDraft(getCanonicalProjects(),{...opts,expectedRevision:first.revision})).toThrow(/changed|conflict/i);
 expect(()=>discardProjectsDraft(opts.dataDir,first.revision)).toThrow(/changed|conflict/i);
 const personal=savePersonalDraft(getCanonicalPersonal(),{...opts,expectedRevision:null});
 clearDrafts(opts.dataDir,{personal:personal.revision,projects:first.revision});
 expect(readDraftBundle(opts.dataDir).personal).toBeNull();
 expect(readDraftBundle(opts.dataDir).projects?.revision).toBe(second.revision);
 expect(readDraftBundle(opts.dataDir).projects?.content[0].shortDescription).toBe('Newer draft');
});
it('migrates a legacy draft under the persistence lock and retains its base/content',()=>{
 const opts=options(false);const target=path.join(opts.dataDir!,'drafts/projects.json');fs.mkdirSync(path.dirname(target),{recursive:true});
 fs.writeFileSync(target,JSON.stringify({schemaVersion:1,baseVersion:'a'.repeat(7),savedAt:'2026-07-09T19:00:00.000Z',content:getCanonicalProjects()}));
 const first=readDraftBundle(opts.dataDir).projects;const second=readDraftBundle(opts.dataDir).projects;
 expect(first?.schemaVersion).toBe(2);expect(first?.revision).toBe(second?.revision);expect(first?.baseVersion).toBe('a'.repeat(7));
 expect(JSON.parse(fs.readFileSync(target,'utf8')).schemaVersion).toBe(2);
});
