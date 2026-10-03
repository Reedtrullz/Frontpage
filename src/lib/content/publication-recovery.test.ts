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
