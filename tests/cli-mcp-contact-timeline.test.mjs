import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {handleCoreMcpRequest} from '../packages/cli/dist/mcp-core-handler.js';
import {CoreOperatorError} from '../packages/cli/dist/operator-core-request.js';
const event={id:randomUUID(),expected_revision:0,occurred_on:'2014-03',title:'Company founded',detail:'The precise day is unknown.',sources:[{url:'https://example.test/about',observed_at:'2026-10-23'}],highlight:true};
const base={workspace:'northstar',contact_id:'organization',expected_revision:'123',operation_id:randomUUID(),milestones:[event]};
async function call(name,args,requester){const response=await handleCoreMcpRequest(new Request('https://app.example.test/mcp',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})}),requester,'https://api.example.test');return (await response.json()).result;}
test('timeline MCP retains identity, dates, sources and revision through the checked API',async()=>{
 const calls=[],requester=async(path,options)=>{calls.push({path,options});return {result:{replayed:false}};};
 await call('fonte_save_contact_milestones',base,requester);
 assert.equal(calls[0].options.body.action,'save_milestones');assert.equal(calls[0].options.body.expectedRevision,'123');
 assert.deepEqual(JSON.parse(JSON.stringify(calls[0].options.body.milestones)),[{id:event.id,expectedRevision:0,occurredOn:'2014-03',title:event.title,detail:event.detail,sources:[{url:event.sources[0].url,observedAt:'2026-10-23'}],highlight:true,archived:false}]);
 await call('fonte_read_contact_milestone',{workspace:'northstar',contact_id:'organization',milestone_id:event.id},requester);
 assert.equal(calls[1].path,`/v1/workspaces/northstar/contact-directory/records/organization/timeline/${event.id}?environment=production`);
 await call('fonte_list_contact_timeline',{workspace:'northstar',contact_id:'organization',if_revision:'123'},requester);
 assert.equal(calls[2].path,'/v1/workspaces/northstar/contact-directory/records/organization/timeline?environment=production&ifRevision=123');
});
test('MCP bounds timeline writes before a requester effect',async()=>{
 for(const overrides of [{title:'word '.repeat(13)},{detail:'word '.repeat(40)},{sources:[]},{raw:'dump'},{subject_contact_ids:['someone-else']}]){
  const result=await call('fonte_save_contact_milestones',{...base,milestones:[{...event,...overrides}]},async()=>assert.fail('invalid milestone must not reach Core'));assert.equal(result.isError,true);
 }
 for(const milestones of [[],Array.from({length:6},()=>({...event,id:randomUUID()})),[event,event]]){
  const result=await call('fonte_save_contact_milestones',{...base,milestones},async()=>assert.fail('invalid batch must not reach Core'));assert.equal(result.isError,true);
 }
});
test('uncertain milestone writes keep their effect and are never retried automatically',async()=>{
 let calls=0;const result=await call('fonte_save_contact_milestones',base,async()=>{calls++;throw new CoreOperatorError('connection_lost',null,'unknown');});
 assert.equal(calls,1);assert.equal(result.structuredContent.outcome,'ambiguous');assert.equal(result.structuredContent.core_effect,'unknown');
});
