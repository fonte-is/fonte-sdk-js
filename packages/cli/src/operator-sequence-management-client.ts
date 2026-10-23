import { CoreOperatorError,type CoreRequester } from "./operator-core-request.js";
import type { SequenceScopeInput,SequenceJsonObject } from "./operator-sequence-types.js";
export type SequenceManagementOperation="review_import"|"read_import"|"bind_form"|"bind_event"|"configure_policy"|"configure_cutover"|"configure_action_connection"|"read_action_connection"|"revoke_action_connection";
export interface SequenceManagementInput extends SequenceScopeInput {operation:SequenceManagementOperation;identity:string;configuration:SequenceJsonObject}
export interface SequenceManagementResult {kind:"sequence_management";operation:SequenceManagementOperation;data:SequenceJsonObject}
export interface SequenceManagementClient {manageSequence(input:SequenceManagementInput):Promise<SequenceManagementResult>}
/** Transport only. Core validates import compatibility, authority, immutable bindings and configuration revisions. */
export function createSequenceManagementClient(request:CoreRequester):SequenceManagementClient{
  return {async manageSequence(input){
    const root=`/v1/workspaces/${encodeURIComponent(input.workspace)}`;
    const paths={review_import:"/sequence-imports",read_import:`/sequence-imports/${encodeURIComponent(input.identity)}`,
      bind_event:`/sequences/${encodeURIComponent(input.identity)}/event-binding`,
      bind_form:`/sequences/${encodeURIComponent(input.identity)}/form-binding`,configure_policy:`/communication-policies/${encodeURIComponent(input.identity)}`,
      configure_action_connection:`/sequence-action-connections/${encodeURIComponent(input.identity)}`,read_action_connection:`/sequence-action-connections/${encodeURIComponent(input.identity)}`,revoke_action_connection:`/sequence-action-connections/${encodeURIComponent(input.identity)}`,
      configure_cutover:`/sequences/${encodeURIComponent(input.identity)}/cutover`};
    const read=input.operation==="read_import"||input.operation==="read_action_connection",revoked=input.operation==="revoke_action_connection";
    const data=await request(`${root}${paths[input.operation]}?environment=${input.environment}`,read?undefined:{method:revoked?"DELETE":input.operation==="review_import"?"POST":"PUT",body:revoked?{}:input.configuration,lostResponseEffect:"unknown"});
    if(!data||typeof data!=="object"||Array.isArray(data))throw new CoreOperatorError("sequence_management_response_invalid",null,read?"none":"unknown");
    const row=data as Record<string,unknown>,revision=Number.isSafeInteger(row.revision)&&Number(row.revision)>0;
    let valid=true;
    if(input.operation.endsWith("action_connection"))valid=row.connectionId===input.identity&&revision
      &&(input.operation==="read_action_connection"?typeof row.revoked==="boolean"&&["notification","business_action"].includes(String(row.capability))
        :input.operation==="revoke_action_connection"?row.revoked===true:true);
    else if(input.operation==="review_import")valid=typeof row.importId==="string"&&!!row.review&&typeof row.review==="object"&&(row.review as Record<string,unknown>).schema==="sequence_import_review.v1";
    else if(input.operation==="read_import")valid=!!row.record&&typeof row.record==="object"&&(row.record as Record<string,unknown>).import_id===input.identity;
    else if(input.operation==="configure_policy")valid=revision&&row.policyId===input.identity;
    else if(input.operation==="bind_event")valid=revision&&row.sequenceId===input.identity&&row.eventType===input.configuration.eventType;
    else if(input.operation==="bind_form")valid=revision;
    else if(input.operation==="configure_cutover")valid=revision&&row.sourceRef===input.configuration.sourceRef&&row.destination===input.configuration.destination;
    if(!valid)throw new CoreOperatorError("sequence_management_response_invalid",null,read?"none":"unknown");
    return {kind:"sequence_management",operation:input.operation,data:data as SequenceJsonObject};
  }};
}
