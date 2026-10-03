import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {mutateOwnerRecord,readOwnerRecord,type ReviewedRevisions} from './drafts';
const sha=z.string().regex(/^[a-f0-9]{40}$/);
const intentSchema=z.object({id:z.string().uuid(),key:z.string().length(64),phase:z.enum(['prepared','ref-pending','committed','complete','failed']),baseSha:sha,reviewedRevisions:z.object({personal:z.string().uuid().nullable(),projects:z.string().uuid().nullable()}).strict(),commitSha:sha.optional(),treeSha:z.string().min(1).max(100).optional(),createdAt:z.string().datetime()}).strict();
const journal=z.object({schemaVersion:z.literal(1),intents:z.array(intentSchema).max(64)}).strict();
export type PublicationIntent=z.infer<typeof intentSchema>;
export function findPublicationIntent(revisions:ReviewedRevisions,dataDir?:string):PublicationIntent | undefined {
  return readOwnerRecord(journal,dataDir)?.intents.toReversed().find(item=>item.phase !== 'failed' && JSON.stringify(item.reviewedRevisions)===JSON.stringify(revisions));
}
export function createPublicationIntent(key:string,baseSha:string,reviewedRevisions:ReviewedRevisions,dataDir?:string):{intent:PublicationIntent;created:boolean}{
 let result:{intent:PublicationIntent;created:boolean}|undefined;
 mutateOwnerRecord(journal,current=>{
  let intents=current?.intents ?? [];
  const prior=intents.find(item=>item.key===key && item.phase!=='failed');
  if(prior){result={intent:prior,created:false};return {schemaVersion:1 as const,intents};}
  if(intents.filter(item=>!['complete','failed'].includes(item.phase)).length>=16)throw new Error('Publication recovery is required before another intent.');
  if(intents.length>=64)intents=intents.filter(item=>!['complete','failed'].includes(item.phase));
  const intent:PublicationIntent={id:randomUUID(),key,phase:'prepared',baseSha,reviewedRevisions,createdAt:new Date().toISOString()};
  result={intent,created:true};return{schemaVersion:1 as const,intents:[...intents,intent]};
 },dataDir);
 if(!result)throw new Error('Publication intent unavailable.');return result;
}
export function updatePublicationIntent(intent:PublicationIntent,update:Partial<PublicationIntent>,dataDir?:string):PublicationIntent {
 const next=intentSchema.parse({...intent,...update});
 mutateOwnerRecord(journal,current=>{if(!current || !current.intents.some(item=>item.id===intent.id))throw new Error('Publication intent unavailable.');return {...current,intents:current.intents.map(item=>item.id===intent.id?next:item)};},dataDir);
 return next;
}
