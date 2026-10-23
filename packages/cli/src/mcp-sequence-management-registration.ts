import type { McpServer } from "@modelcontextprotocol/server";
import {z} from "zod";
import type {SequenceMcpClientProvider} from "./mcp-sequence-tools.js";
import type {SequenceManagementClient,SequenceManagementOperation} from "./operator-sequence-management-client.js";
import {sequenceMcpFailure} from "./mcp-sequence-failure.js";
import type {SequenceJsonObject} from "./operator-sequence-types.js";
export const MCP_SEQUENCE_MANAGEMENT_TOOLS=["fonte_review_automation_import","fonte_read_automation_import","fonte_bind_sequence_form","fonte_configure_communication_policy","fonte_configure_sequence_cutover","fonte_bind_sequence_event","fonte_configure_sequence_action_connection","fonte_read_sequence_action_connection","fonte_revoke_sequence_action_connection"] as const;
export function registerMcpSequenceManagementTools(server:McpServer,provider:SequenceMcpClientProvider){
  const operations:SequenceManagementOperation[]=["review_import","read_import","bind_form","configure_policy","configure_cutover","bind_event","configure_action_connection","read_action_connection","revoke_action_connection"];
  MCP_SEQUENCE_MANAGEMENT_TOOLS.forEach((name,index)=>server.registerTool(name,{
    title:["Review an automation source","Inspect an automation import","Bind a native Form to a Sequence","Configure shared communication policy","Configure future episode routing","Bind canonical event entry","Configure action credential custody","Inspect action connection","Revoke action connection"][index]!,
    description:["Stores an untrusted source snapshot and Core compatibility review. Unsupported behavior remains non-activatable; fixture evidence is not provider qualification.",
      "Reads the exact preserved source and native equivalent through current workspace authority.",
      "Revision-checks an exact Form and activated subscription Sequence. New eligible subscriptions can start work.",
      "Revision-checks explicit shared frequency and local-time window rules. Core enforces current administrator authority.",
      "Revision-checks future routing for the exact supported imported equivalent. Existing episode routing is preserved; no mid-flight transfer.","Binds one canonical event type to an exact activated version. Commits capture entry durably; transport replay never creates a second logical episode.","Configures an exact supported action endpoint under Core owner/admin authority. Credentials enter encrypted custody; the result never returns them.","Reads current capability, revision and revocation metadata without credentials.","Revokes a scoped connection through current Core authority. Future dispatch and callbacks refuse."][index]!,
    inputSchema:z.object({workspace:z.string().min(2).max(63),environment:z.enum(["sandbox","production"]),identity:z.string().max(200),configuration:z.record(z.string(),z.unknown())}).strict(),
    annotations:{readOnlyHint:index===1||index===7,destructiveHint:index===8,idempotentHint:true,openWorldHint:index===2||index===4||index===5},
  },async input=>{
    try{const client=await provider() as Partial<SequenceManagementClient>;if(!client.manageSequence)throw new Error("Sequence management unavailable");
      const result=await client.manageSequence({workspace:input.workspace,environment:input.environment,operation:operations[index]!,identity:input.identity,configuration:input.configuration as SequenceJsonObject});
      return envelope({outcome:"completed",result});
    }catch(error){return envelope(sequenceMcpFailure(error));}
  }));
}
function envelope(value:object){return {content:[{type:"text" as const,text:JSON.stringify(value)}],structuredContent:value};}
