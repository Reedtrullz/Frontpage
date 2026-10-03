import {createRequire} from 'node:module';
import {afterEach,expect,it,vi} from 'vitest';
import {getCanonicalPersonal,getCanonicalProjects} from './index';
import {readDraftBundle,saveProjectsDraft} from './drafts';
import {publishCanonicalContent,type GitPublicationClient} from './publication';
import {findPendingPublicationIntent} from './publication-intents';
const context=vi.hoisted(()=>({sql:undefined as unknown}));
vi.mock('@opennextjs/cloudflare',()=>({getCloudflareContext:()=>({env:{FRONTPAGE_SQL:context.sql}})}));
afterEach(()=>{vi.unstubAllEnvs();vi.restoreAllMocks();});
it.each(['receipt','cleanup','acknowledgement','response-loss'] as const)('reconciles %s in SQLite without duplicate publication or lost newer drafts',async(mode)=>{
 const {DatabaseSync}=createRequire(import.meta.url)('node:sqlite'),db=new DatabaseSync(':memory:');let failureEnabled=false;
 const sql={exec(query:string,...bindings:string[]){
  if(failureEnabled && ((mode==='receipt' && bindings[0]==='receipts/publication.json') || (mode==='cleanup' && query.startsWith('DELETE FROM owner_state')) || (mode==='acknowledgement' && bindings[0]==='receipts/publication-intents.json' && bindings[1].includes('"phase":"complete"'))))throw new Error('injected private SQL failure');
  const rows=db.prepare(query).all(...bindings);return{toArray:()=>rows};
 }};
 context.sql=sql;vi.stubEnv('FRONTPAGE_CLOUDFLARE','1');vi.stubEnv('DATA_DIR','/data');
 const base='a'.repeat(40),target='b'.repeat(40),projects=getCanonicalProjects();let head=base;
 try{
  const draft=saveProjectsDraft(projects,{baseVersion:base});
  const client:GitPublicationClient={getHead:vi.fn(async()=>({commitSha:head,treeSha:head===base?'before':'after'})),createBlob:vi.fn(async()=> 'blob'),createTree:vi.fn(async()=> 'after'),createCommit:vi.fn(async()=>target),getCommitUrl:sha=>'https://github.com/Reedtrullz/Frontpage/commit/'+sha,getCommitIdentity:vi.fn(async()=>({treeSha:'after',parentSha:base})),isAncestor:vi.fn(async()=>head===target),updateHead:vi.fn(async()=>{
   head=target;failureEnabled=true;
   if(mode==='response-loss'){
    const changed=structuredClone(projects);changed[0].shortDescription='Newer synthetic SQL draft while publication awaited';saveProjectsDraft(changed,{baseVersion:base,expectedRevision:draft.revision});throw new Error('response lost');
   }
  })};
  const input={personal:getCanonicalPersonal(),projects,baseVersion:base,reviewedRevisions:{personal:null,projects:draft.revision}};
  const result=await publishCanonicalContent(input,client);expect(result.kind).toBe(mode==='response-loss'?'published':'published-recovery-pending');
  failureEnabled=false;expect((await publishCanonicalContent(input,client)).kind).toBe('published');expect(client.createCommit).toHaveBeenCalledTimes(1);expect(findPendingPublicationIntent()).toBeUndefined();expect(readDraftBundle().receipt).toMatchObject({kind:'published',commitSha:target});
  if(mode==='response-loss')expect(readDraftBundle().projects?.content[0].shortDescription).toContain('Newer synthetic SQL draft');else expect(readDraftBundle().projects).toBeNull();
 }finally{db.close();}
});
