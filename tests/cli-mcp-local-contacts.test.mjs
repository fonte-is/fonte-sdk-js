import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createInterface} from 'node:readline';
import test from 'node:test';
import {MCP_CONTACT_DIRECTORY_TOOLS} from '../packages/cli/dist/mcp-contact-directory-tools.js';
import {MCP_FONTE_TOOLS} from '../packages/cli/dist/mcp-tool-inventory.js';

test('a fresh local MCP exposes contact operations, uses current auth, and preserves the checked contract',async t=>{
 const directory=await mkdtemp(path.join(tmpdir(),'fonte-local-contacts-')),effects=path.join(directory,'effects.json');
 t.after(()=>rm(directory,{recursive:true,force:true}));
 const child=spawn(process.execPath,['tests/fixtures/cli-mcp-contacts-stdio.mjs'],{
  env:{...process.env,FONTE_MCP_EFFECTS_FILE:effects},stdio:['pipe','pipe','pipe']});
 const lines=createInterface({input:child.stdout}),pending=new Map();let id=0,output='',stderr='';
 const exited=new Promise(resolve=>child.once('exit',resolve));
 lines.on('line',line=>{output+=line;const message=JSON.parse(line);pending.get(message.id)?.(message);pending.delete(message.id);});
 child.stderr.on('data',chunk=>stderr+=chunk);
 let closed=false;
 const close=async()=>{if(closed)return;closed=true;child.kill('SIGTERM');await exited;lines.close();};t.after(close);
 const request=(method,params)=>new Promise((resolve,reject)=>{
  const requestId=++id,timer=setTimeout(()=>{pending.delete(requestId);reject(new Error(`Timed out: ${method}`));},10000);
  pending.set(requestId,message=>{clearTimeout(timer);resolve(message);});
  child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:requestId,method,params})+'\n');
 });
 const call=async(name,args)=>(await request('tools/call',{name,arguments:{workspace:'northstar',...args}})).result;
 await request('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'contact-regression',version:'1'}});
 child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized',params:{}})+'\n');
 const tools=(await request('tools/list',{})).result.tools,names=tools.map(tool=>tool.name);
 assert.deepEqual(names,[...MCP_FONTE_TOOLS]);assert.equal(new Set(names).size,names.length);
 for(const name of MCP_CONTACT_DIRECTORY_TOOLS)assert.ok(names.includes(name),name);
 const operation='10000000-0000-4000-8000-000000000001';
 for(const args of [{record_type:'organization',name:'Synthetic company',website:'https://example.test'},
  {record_type:'individual',name:'Synthetic founder'}]){
  const value=await call('fonte_create_contact',{operation_id:operation,...args,description:args.record_type==='organization'?'Monitoring software for operations teams.':'Founder at the synthetic company.',description_sources:[{url:'https://example.test/about'}]});assert.equal(value.structuredContent.outcome,'completed',JSON.stringify(value.structuredContent));
 }
 await call('fonte_link_contact',{operation_id:operation,person_id:'person',organization_id:'company',expected_revision:'123',role:'Founder',is_primary:true});
 await call('fonte_save_contact_context',{operation_id:operation,contact_id:'company',expected_revision:'124',context:{brief:'A sourced prospect.',findings:[],questions:[],next_action:'Review the offer.'}});
 await call('fonte_set_contact_list_membership',{operation_id:operation,contact_id:'company',list_id:operation,expected_revision:'125',member:true});
 await call('fonte_find_contacts',{records:'organizations',search:'Synthetic company'});
 const invalid=await call('fonte_save_contact_context',{operation_id:operation,contact_id:'company',expected_revision:'126',context:{brief:'word '.repeat(151),findings:[],questions:[],next_action:''}});
 assert.equal(invalid.isError,true);
 for(const description of ['a'.repeat(161),Array(21).fill('a').join(' '),'Two\nlines']){
  const rejected=await call('fonte_update_contact',{operation_id:operation,contact_id:'company',expected_revision:'126',description,description_sources:[{url:'https://example.test/about'}]});assert.equal(rejected.isError,true);
 }
 const loggedOut=await call('fonte_read_contact',{contact_id:'company'});assert.equal(loggedOut.structuredContent.reason,'login_required');
 await close();const proof=JSON.parse(await readFile(effects,'utf8'));
 assert.equal(proof.authorizations,7);assert.equal(proof.requests.length,6);
 assert.deepEqual(proof.requests.slice(0,2).map(r=>r.body.contactKind),['organization','individual']);
 assert.equal(proof.requests[0].body.operationId,operation);assert.equal(proof.requests[0].body.permissionConfirmed,undefined);assert.equal(proof.requests[0].body.description,'Monitoring software for operations teams.');assert.equal(proof.requests[0].body.descriptionSources[0].url,'https://example.test/about');
 assert.deepEqual(proof.requests.slice(2,5).map(r=>r.body.action),['link_contact','save_context','set_membership']);
 assert.equal(proof.requests[3].body.context.nextAction,'Review the offer.');
 assert.ok(proof.requests.every(r=>r.path.endsWith('?environment=production')));
 assert.equal(stderr,'');assert.equal(output.includes('synthetic-contact-session'),false);
});
