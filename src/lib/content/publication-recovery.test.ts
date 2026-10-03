import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {afterEach,expect,it,vi} from 'vitest';
import {getCanonicalPersonal,getCanonicalProjects} from './index';
import {readDraftBundle,saveProjectsDraft} from './drafts';
import {publishCanonicalContent,type GitPublicationClient} from './publication';
const dirs:string[]=[];afterEach(()=>{vi.restoreAllMocks();dirs.splice(0).forEach(p=>fs.rmSync(p,{recursive:true,force:true}));});
function fixture(){const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'frontpage-recovery-'));dirs.push(dataDir);const base='a'.repeat(40),target='b'.repeat(40);let head=base;
 const projects=getCanonicalProjects();const draft=saveProjectsDraft(projects,{dataDir,baseVersion:base});
 const client:GitPublicationClient={getHead:vi.fn(async()=>({commitSha:head,treeSha:head===target?'new-tree':'old-tree'})),createBlob:vi.fn(async()=> 'blob'),createTree:vi.fn(async()=> 'new-tree'),createCommit:vi.fn(async()=>target),updateHead:vi.fn(async()=>{head=target;}),getCommitUrl:sha=>'https://github.com/Reedtrullz/Frontpage/commit/'+sha,getCommitIdentity:vi.fn(async()=>({treeSha:'new-tree',parentSha:base})),isAncestor:vi.fn(async()=>head===target)};
 return{dataDir,client,projects,base,target,input:{personal:getCanonicalPersonal(),projects,baseVersion:base,dataDir,reviewedRevisions:{personal:null,projects:draft.revision}}};}
it('reports committed recovery pending when receipt persistence fails and retry reconciles once',async()=>{const f=fixture();const write=fs.writeFileSync;const spy=vi.spyOn(fs,'writeFileSync').mockImplementation(((file,...args)=>{if(String(file).includes('.publication.json.'))throw new Error('private storage failure');return write(file,...args);}) as typeof fs.writeFileSync);
 expect((await publishCanonicalContent(f.input,f.client)).kind).toBe('published-recovery-pending');spy.mockRestore();
 expect((await publishCanonicalContent(f.input,f.client)).kind).toBe('published');expect(f.client.createCommit).toHaveBeenCalledTimes(1);expect(readDraftBundle(f.dataDir).projects).toBeNull();
});
it('reconciles a lost ref update response and preserves a newer draft',async()=>{const f=fixture();const update=vi.mocked(f.client.updateHead).getMockImplementation()!;vi.mocked(f.client.updateHead).mockImplementation(async sha=>{await update(sha);const previous=readDraftBundle(f.dataDir).projects!;const changed=structuredClone(f.projects);changed[0].shortDescription='saved while GitHub awaited';saveProjectsDraft(changed,{dataDir:f.dataDir,baseVersion:f.base,expectedRevision:previous.revision});throw new Error('response lost');});
 expect((await publishCanonicalContent(f.input,f.client)).kind).toBe('published');expect(readDraftBundle(f.dataDir).projects?.content[0].shortDescription).toBe('saved while GitHub awaited');expect(f.client.createCommit).toHaveBeenCalledTimes(1);
});
it('expires abandoned preparation safely before starting another commit',async()=>{
 const f=fixture();const {createPublicationIntent}=await import('./publication-intents');
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-03T10:00:00Z'));
 createPublicationIntent('d'.repeat(64),f.base,f.input.reviewedRevisions,f.dataDir);
 vi.setSystemTime(new Date('2026-10-03T10:06:00Z'));
 try{expect((await publishCanonicalContent(f.input,f.client)).kind).toBe('published');expect(f.client.createCommit).toHaveBeenCalledTimes(1);}finally{vi.useRealTimers();}
});
it('does not rewrite the receipt when an already complete publication is retried',async()=>{
 const f=fixture();expect((await publishCanonicalContent(f.input,f.client)).kind).toBe('published');
 const file=path.join(f.dataDir,'receipts/publication.json'),before=fs.readFileSync(file,'utf8');
 expect((await publishCanonicalContent(f.input,f.client)).kind).toBe('published');expect(fs.readFileSync(file,'utf8')).toBe(before);expect(f.client.createCommit).toHaveBeenCalledTimes(1);
});
it('reports local cleanup failure after a confirmed commit and retries only cleanup',async()=>{
 const f=fixture(),remove=fs.rmSync;
 const spy=vi.spyOn(fs,'rmSync').mockImplementation(((file,...args)=>{if(String(file).endsWith('/drafts/projects.json'))throw new Error('injected cleanup failure');return remove(file,...args);}) as typeof fs.rmSync);
 expect((await publishCanonicalContent(f.input,f.client)).kind).toBe('published-recovery-pending');
 expect(readDraftBundle(f.dataDir).receipt?.kind).toBe('published');expect(readDraftBundle(f.dataDir).projects?.revision).toBe(f.input.reviewedRevisions.projects);spy.mockRestore();
 expect((await publishCanonicalContent(f.input,f.client)).kind).toBe('published');expect(readDraftBundle(f.dataDir).projects).toBeNull();expect(f.client.createCommit).toHaveBeenCalledTimes(1);
});
