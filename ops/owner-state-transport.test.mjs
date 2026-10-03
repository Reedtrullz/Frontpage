import assert from 'node:assert/strict';
import {test} from 'node:test';
import {restoreRemoteOwnerState,UnknownRestoreOutcomeError} from './owner-state-transport.mjs';
const backup={source:{target:'synthetic-source'},records:[{key:'drafts/projects.json',value:{revision:'synthetic-private-state'}}]};
const readback={...backup,source:{target:'isolated-target'}};
test('lost PUT response reconciles exact state with one read and no duplicate mutation',async()=>{
 let writes=0,reads=0;
 const result=await restoreRemoteOwnerState({backup,target:'isolated-target',put:async()=>{writes++;throw new Error('response lost');},read:async()=>{reads++;return readback;},validate:value=>value});
 assert.deepEqual(result,{stateConfirmed:true,writeAcknowledged:false,reconciled:true});assert.equal(writes,1);assert.equal(reads,1);
});
test('unreachable or mismatched readback reports unknown rather than unchanged or restored',async()=>{
 for(const read of [async()=>{throw new Error('offline');},async()=>({...readback,records:[]}),async()=>({...readback,source:{target:'different-target'}})]) {
  await assert.rejects(restoreRemoteOwnerState({backup,target:'isolated-target',put:async()=>{},read,validate:value=>value}),UnknownRestoreOutcomeError);
 }
});
