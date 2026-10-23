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
test('contact context keeps stable identity, revisions and sources through the ordinary requester',async()=>{
 const calls=[],requester=async(path,options)=>{calls.push({path,options});return {result:{replayed:false}};};
 const created=await call('fonte_create_contact',{workspace,operation_id:id,record_type:'organization',name:'Observatory',
  website:'https://observatory.example.test',organization_type:'workspace-choice',external_reference:{namespace:'research_fixture',id}},requester);
 assert.equal(created.structuredContent.outcome,'completed');assert.equal(calls[0].path,'/v1/workspaces/northstar/contacts?environment=production');
 assert.deepEqual(calls[0].options.body.externalReference,{namespace:'research_fixture',id});
 assert.equal(calls[0].options.body.permissionConfirmed,undefined);
 const context={brief:'Established monitoring software.',findings:[{id:'company',text:'Independent since 2014.',sources:[{url:'https://observatory.example.test/about',observed_at:'2026-10-23'}]}],questions:['What have they tried?'],next_action:'Draft an invitation.'};
 await call('fonte_save_contact_context',{workspace,operation_id:id,contact_id:'organization',expected_revision:'123',context,subject_contact_ids:['organization','person']},requester);
 assert.deepEqual(JSON.parse(JSON.stringify(calls[1].options.body.context)),{brief:context.brief,questions:context.questions,nextAction:context.next_action,findings:[{...context.findings[0],sources:[{url:context.findings[0].sources[0].url,observedAt:'2026-10-23'}]}]});
 assert.deepEqual(calls[1].options.body.subjectContactIds,['organization','person']);
 assert.equal(calls[1].options.body.expectedRevision,'123');assert.equal(calls[1].options.lostResponseEffect,'unknown');
 await call('fonte_read_contact_research',{workspace,contact_id:'organization',entry_id:'original'},requester);
 assert.equal(calls[2].path,'/v1/workspaces/northstar/contact-directory/records/organization/entries/original?environment=production');
});
test('structured queries remain read-only and keep all organization conditions together',async()=>{
 let observed;
 await call('fonte_find_contacts',{workspace,records:'individuals',organization:{list_id:id,filters:[{field:'country',operator:'is',value:'US'},{field:'directory_industry',operator:'is',value:'Software'}]}},async(path,options)=>{
  observed={path,options};return {result:{rows:[],matchingCount:0,nextAfter:null}};});
 assert.equal(observed.options.lostResponseEffect,'none');assert.equal(observed.options.body.organization.listId,id);assert.equal(observed.options.body.organization.filters.length,2);
 assert.equal(observed.options.body.listId,undefined);
 const names=new Set(MCP_CONTACT_DIRECTORY_TOOLS);assert.equal(names.size,20);
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
  {workspace,operation_id:id,record_type:'individual',name:'A',environment:'development'}]){
  const result=await call('fonte_create_contact',args,async()=>{effects++;});assert.equal(result.isError,true);
 }
 assert.equal(effects,0);
 const result=await call('fonte_update_contact',{workspace,operation_id:id,contact_id:'person',expected_revision:'123',values:{country:'US'}},async()=>{effects++;throw new CoreOperatorError('connection_lost',null,'unknown');});
 assert.equal(effects,1);assert.equal(result.structuredContent.outcome,'ambiguous');assert.equal(result.structuredContent.core_effect,'unknown');
});

test('agent limits reject dossier writes before making a request',async()=>{
 const base={brief:'Current opportunity.',findings:[],questions:[],next_action:'Ask what they have tried.'};
 const finding={id:'source',text:'A sourced fact.',sources:[{url:'https://observatory.example.test/about'}]};
 for(const context of [{...base,brief:'word '.repeat(151)},{...base,findings:Array.from({length:6},(_,i)=>({...finding,id:String(i)}))},
  {...base,questions:['one','two','three','four']},{...base,next_action:['one','two']},{...base,payload:{raw:'dump'}},
  {...base,findings:[{...finding,sources:[]}]}]){
  const result=await call('fonte_save_contact_context',{workspace,operation_id:id,contact_id:'organization',expected_revision:'123',context},async()=>assert.fail('Oversized context must not reach Core'));
  assert.equal(result.isError,true);
 }
 for(const overrides of [{kind:'import'},{payload:{raw:'dump'}},{body:'word '.repeat(81)}]){
  const result=await call('fonte_append_contact_research',{workspace,operation_id:id,contact_id:'organization',expected_revision:'123',entry_id:id,kind:'note',body:'A decision.',...overrides},async()=>assert.fail('Raw research must not reach Core'));
  assert.equal(result.isError,true);
 }
});

test('descriptions retain sources and revisions and reject overflow on create and update',async()=>{
 const sources=[{url:'https://observatory.example.test/about',observed_at:'2026-10-23'}];
 const description='Monitoring software for operations teams.';
 const operations=[['fonte_create_contact',{record_type:'organization',name:'Observatory'}],['fonte_update_contact',{contact_id:'company',expected_revision:'123'}]];
 for(const [name,fields] of operations){
  const args={workspace,operation_id:id,...fields,description,description_sources:sources};let effect;
  const saved=await call(name,args,async(path,options)=>{effect=options;return {result:{replayed:false}};});
  assert.equal(saved.structuredContent.outcome,'completed');assert.equal(effect.body.description,description);
  assert.deepEqual(effect.body.descriptionSources,[{url:sources[0].url,title:undefined,publishedAt:undefined,observedAt:'2026-10-23'}]);
  for(const invalid of [{description:'a'.repeat(161)},{description:Array(21).fill('a').join(' ')},{description:'Two\nlines'},
    {description:'Hidden\u200bwords'},{description:'<b>Markup</b>'},{description_sources:[]},{description_sources:Array(4).fill(sources[0])},
    {description:undefined},{description_sources:[sources[0],sources[0]]}]){
   const denied=await call(name,{...args,...invalid},async()=>assert.fail('Invalid identity must not reach Core'));assert.equal(denied.isError,true);
  }
 }
});


test('contact dates pass through the normal read tools and cannot be supplied as edits',async()=>{
 const dates={lastContactedAt:'2026-10-21T14:00:00.000Z',lastClickedAt:'2026-10-22T10:00:00.000Z',emailActivityCoverage:'recorded_broadcast_email',createdAt:'2026-01-01T00:00:00.000Z'};
 let reads=0;
 const read=await call('fonte_read_contact',{workspace,contact_id:id},async()=>{reads++;return {result:{contactId:id,...dates}};});
 assert.deepEqual(read.structuredContent.receipt.result,{contactId:id,...dates});
 let body;
 const filters=[{field:'last_contacted',operator:'before',value:'2026-10-01T00:00:00Z'},{field:'last_clicked',operator:'is_empty'}];
 const found=await call('fonte_find_contacts',{workspace,dates:filters},async(path,options)=>{reads++;body=options.body;assert.equal(options.lostResponseEffect,'none');return {result:{rows:[{contactId:id,...dates}]}};});
 assert.deepEqual(body.dates,filters);assert.equal(found.structuredContent.receipt.result.rows[0].lastClickedAt,dates.lastClickedAt);
 for(const field of ['lastContactedAt','lastClickedAt','emailActivityCoverage']){
  const invalid=await call('fonte_update_contact',{workspace,contact_id:id,operation_id:id,expected_revision:'123',[field]:'invented'},async()=>{assert.fail('Read-only activity cannot reach Core');});
  assert.equal(invalid.isError,true);
 }
 assert.equal(reads,2);
});


test('contact reads accept an explicit sandbox while preserving the production default',async()=>{
 let path;
 await call('fonte_read_contact',{workspace,contact_id:id,environment:'sandbox'},async(value)=>{path=value;return {result:{contactId:id}};});
 assert.equal(path,'/v1/workspaces/northstar/contact-directory/records/'+id+'?environment=sandbox');
});
