import {writeFileSync} from 'node:fs';
import {StdioServerTransport} from '@modelcontextprotocol/server/stdio';
import {createDurableFonteMcpSession,createFonteMcpServer,MCP_FONTE_TOOLS} from '../../packages/cli/dist/mcp-sequence-server.js';
import {HostedTestBlockedError} from '../../packages/cli/dist/hosted-errors.js';

const configUrl='http://127.0.0.1:43111/.well-known/fonte-cli.json';
let authorizations=0;
const requests=[];
const session=createDurableFonteMcpSession({configUrl,
 authorize:async()=>{if(++authorizations>6)throw new HostedTestBlockedError('login_required');return 'synthetic-contact-session';},
 fetch:async(input,init={})=>{
  if(String(input)===configUrl)return Response.json({schema:'fonte.cli.hosted_config.v1',
   authorizationServer:'https://identity.example.test/auth/v1',clientId:'fonte-cli-client-v0',
   coreApiBaseUrl:'https://api.example.test',redirectUri:'http://127.0.0.1:49671/callback',scopes:['email']});
  if(new Headers(init.headers).get('authorization')!=='Bearer synthetic-contact-session')throw new Error('missing_current_identity');
  const url=new URL(String(input)),body=init.body?JSON.parse(init.body):null;
  if(!url.pathname.startsWith('/v1/workspaces/northstar/contact'))throw new Error('unrelated_endpoint');
  requests.push({path:url.pathname+url.search,body});
  return Response.json({tenantId:'synthetic-workspace',environment:'production',result:{received:body}});
 }
});
const server=createFonteMcpServer(session,{
 inspectHost:async()=>({initialized:true,tools:MCP_FONTE_TOOLS}),
 readSession:async()=>({status:{state:'ready',serverCheck:'not_checked'},storageAvailable:true}),
 listWorkspaces:async()=>[{slug:'northstar',name:'Synthetic company'}],readSelectedWorkspace:async()=>'northstar',
});
process.once('SIGTERM',()=>{
 writeFileSync(process.env.FONTE_MCP_EFFECTS_FILE,JSON.stringify({authorizations,requests}));process.exit(0);
});
await server.connect(new StdioServerTransport(process.stdin,process.stdout,{maxBufferSize:1_048_576}));
