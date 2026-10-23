import assert from 'node:assert/strict';
import test from 'node:test';
import {handleCoreMcpRequest} from '../packages/cli/dist/mcp-core-handler.js';
import {MCP_CONTACT_DIRECTORY_TOOLS} from '../packages/cli/dist/mcp-contact-directory-tools.js';
import {CoreOperatorError} from '../packages/cli/dist/operator-core-request.js';
const id='77777777-7777-4777-8777-777777777777',workspace='northstar';
async function call(name,args,requester){
 const response=await handleCoreMcpRequest(new Request('https://app.example.test/mcp',{
  method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'},
  body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})}),requester,'https://api.example.test');
 return (await response.json()).result;
}
test('research MCP passes stable identity, revisions and complete evidence through the ordinary requester',async()=>{
 const calls=[],requester=async(path,options)=>{calls.push({path,options});return {result:{replayed:false}};};
 const created=await call('fonte_create_contact',{workspace,operation_id:id,record_type:'organization',name:'Observatory',
  website:'https://observatory.example.test',organization_type:'workspace-choice',external_reference:{namespace:'research_fixture',id}},requester);
 assert.equal(created.structuredContent.outcome,'completed');assert.equal(calls[0].path,'/v1/workspaces/northstar/contacts?environment=production');
 assert.deepEqual(calls[0].options.body.externalReference,{namespace:'research_fixture',id});
 assert.equal(calls[0].options.body.permissionConfirmed,undefined);
 const payload={originalId:id,versions:[{revision:1,unknowns:['current email practice']}]};
 await call('fonte_append_contact_research',{workspace,operation_id:id,contact_id:'organization',expected_revision:'123',entry_id:id,kind:'import',body:'Preserved',payload,
  sources:[{url:'https://observatory.example.test/about',sourceId:'source-1'}],subject_contact_ids:['organization','person']},requester);
 assert.deepEqual(calls[1].options.body.payload,payload);assert.deepEqual(calls[1].options.body.subjectContactIds,['organization','person']);
 assert.equal(calls[1].options.body.expectedRevision,'123');assert.equal(calls[1].options.lostResponseEffect,'unknown');
});
test('structured queries remain read-only and keep all organization conditions together',async()=>{
 let observed;
 await call('fonte_find_contacts',{workspace,records:'individuals',organization:{list_id:id,filters:[{field:'country',operator:'is',value:'US'},{field:'directory_industry',operator:'is',value:'Software'}]}},async(path,options)=>{
  observed={path,options};return {result:{rows:[],matchingCount:0,nextAfter:null}};});
 assert.equal(observed.options.lostResponseEffect,'none');assert.equal(observed.options.body.organization.listId,id);assert.equal(observed.options.body.organization.filters.length,2);
 assert.equal(observed.options.body.listId,undefined);
 const names=new Set(MCP_CONTACT_DIRECTORY_TOOLS);assert.equal(names.size,16);
});
test('organization outreach stops require explicit scope and retain their original mutation identity',async()=>{
 const args={workspace,operation_id:id,contact_id:'organization',expected_revision:'123',requested_by:'Synthetic requester',request:'Stop sales outreach to our organization.',whole_organization:true};
 const calls=[];
 await call('fonte_stop_organization_outreach',args,async(path,options)=>{calls.push({path,options});return {result:{replayed:false,enforcement:'enforced'}};});
 assert.equal(calls[0].path,'/v1/workspaces/northstar/contact-directory/commands?environment=production');
 assert.deepEqual(calls[0].options.body,{operationId:id,action:'stop_organization_outreach',contactId:'organization',expectedRevision:'123',
  requestedBy:args.requested_by,request:args.request,wholeOrganization:true});
 assert.equal(calls[0].options.lostResponseEffect,'unknown');
 for(const overrides of [{whole_organization:false},{whole_organization:undefined},{requested_by:''},{request:''},{subscribe:true}]){
  const result=await call('fonte_stop_organization_outreach',{...args,...overrides},async()=>{assert.fail('Invalid stop must never reach Core');});
  assert.equal(result.isError,true);
 }
});
test('invalid research mutation scope never reaches Core and uncertain writes are not retried',async()=>{
 let effects=0;
 for(const args of [{workspace,operation_id:'unstable',record_type:'organization',name:'A'},
  {workspace,operation_id:id,record_type:'organization',name:'A',email:'company@example.test'},
  {workspace,operation_id:id,record_type:'individual',name:'A',environment:'sandbox'}]){
  const result=await call('fonte_create_contact',args,async()=>{effects++;});assert.equal(result.isError,true);
 }
 assert.equal(effects,0);
 const result=await call('fonte_update_contact',{workspace,operation_id:id,contact_id:'person',expected_revision:'123',values:{country:'US'}},async()=>{effects++;throw new CoreOperatorError('connection_lost',null,'unknown');});
 assert.equal(effects,1);assert.equal(result.structuredContent.outcome,'ambiguous');assert.equal(result.structuredContent.core_effect,'unknown');
});
