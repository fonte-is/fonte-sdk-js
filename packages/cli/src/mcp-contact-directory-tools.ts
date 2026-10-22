import { z } from "zod";
import type { CoreRequester } from "./operator-core-request.js";

export const MCP_CONTACT_DIRECTORY_TOOLS = [
  "fonte_read_contact_configuration","fonte_define_contact_field","fonte_define_contact_list",
  "fonte_find_contacts","fonte_create_contact","fonte_read_contact","fonte_update_contact",
  "fonte_link_contact","fonte_set_contact_list_membership","fonte_append_contact_research",
  "fonte_set_contact_email","fonte_read_contact_research","fonte_read_contact_list_history",
  "fonte_define_contact_view","fonte_list_contact_research",
] as const;
type Register = (name:string,schema:z.ZodType,description:string,mutation:boolean,operation:(input:any)=>Promise<unknown>)=>void;
const value=z.union([z.string(),z.number().finite(),z.boolean(),z.array(z.string()).max(100),z.null()]);
const fields=z.record(z.string().regex(/^[a-z][a-z0-9_]{0,99}$/),value);
const filter=z.strictObject({field:z.string().regex(/^[a-z][a-z0-9_]{0,99}$/),operator:z.enum(['is','is_any_of','is_empty']),value:value.optional()});
const choice=z.strictObject({id:z.string().min(1).max(200),label:z.string().min(1).max(200),archived:z.boolean().default(false)});
const field=z.strictObject({key:z.string().regex(/^[a-z][a-z0-9_]{0,99}$/),label:z.string().min(1).max(200),
  type:z.enum(['string','number','boolean','date','datetime','select','multiselect']),
  applies_to:z.enum(['any','individual','organization']).default('any'),choices:z.array(choice).max(500).default([]),state:z.enum(['active','archived','deleted']).default('active')});
const source=z.object({url:z.url().max(2000),title:z.string().max(500).optional()}).passthrough();

export function registerContactDirectoryTools(register:Register,request:CoreRequester) {
  const workspace={workspace:z.string().min(2).max(63)},mutation={...workspace,operation_id:z.uuid()},
    record={...workspace,contact_id:z.string().min(1).max(200)},edit={...mutation,contact_id:record.contact_id,expected_revision:z.string().regex(/^[0-9]+$/).max(100)};
  const path=(v:{workspace:string})=>`/v1/workspaces/${encodeURIComponent(v.workspace)}/contact-directory`;
  const call=(v:{workspace:string;operation_id:string},action:string,body:Record<string,unknown>)=>request(`${path(v)}/commands?environment=production`,{
    body:{operationId:v.operation_id,action,...body},lostResponseEffect:'unknown'});
  register(MCP_CONTACT_DIRECTORY_TOOLS[0],z.strictObject(workspace),
    'Read this workspace’s field definitions, stable choices and configurable contact lists. Does not create defaults or change records.',false,
    v=>request(`${path(v)}/configuration?environment=production`));
  register(MCP_CONTACT_DIRECTORY_TOOLS[1],z.strictObject({...mutation,expected_revision:z.number().int().nonnegative(),field}),
    'Create a workspace field at revision 0 or update its label, applicability and choices at the current revision. Choice IDs remain stable; omitted existing choices are archived. Existing field types cannot change.',true,
    v=>call(v,'define_field',{expectedRevision:v.expected_revision,field:{key:v.field.key,label:v.field.label,type:v.field.type,
      appliesTo:v.field.applies_to,choices:v.field.choices,state:v.field.state}}));
  register(MCP_CONTACT_DIRECTORY_TOOLS[2],z.strictObject({...mutation,list_id:z.uuid(),name:z.string().min(1).max(200),
    criteria:z.record(z.string(),z.unknown()).default({}),expected_revision:z.number().int().nonnegative(),archived:z.boolean().default(false)}),
    'Create or revise a contact list and its workspace-owned criteria. Revision 0 creates it; renaming preserves membership and version history. List membership grants no sending permission.',true,
    v=>call(v,'define_list',{id:v.list_id,name:v.name,criteria:v.criteria,expectedRevision:v.expected_revision,archived:v.archived}));
  register(MCP_CONTACT_DIRECTORY_TOOLS[3],z.strictObject({...workspace,records:z.enum(['individuals','organizations']).optional(),search:z.string().min(1).max(200).optional(),
    list_id:z.uuid().optional(),filters:z.array(filter).max(20).default([]),
    organization:z.strictObject({list_id:z.uuid().optional(),filters:z.array(filter).max(20).default([])}).optional(),
    after:z.string().min(1).max(2048).optional(),limit:z.number().int().min(1).max(100).default(25)}),
    'Find contact records by name or website, workspace field values and list membership. All organization predicates must match the same linked organization. Follow nextAfter to page the complete result.',false,
    v=>request(`${path(v)}/query?environment=production`,{body:{records:v.records,search:v.search,listId:v.list_id,filters:v.filters,
      organization:v.organization?{listId:v.organization.list_id,filters:v.organization.filters}:undefined,after:v.after,limit:v.limit},lostResponseEffect:'none'}));
  register(MCP_CONTACT_DIRECTORY_TOOLS[4],z.strictObject({...mutation,record_type:z.enum(['individual','organization']),name:z.string().min(1).max(200),
    email:z.email().max(320).optional(),website:z.string().max(500).optional(),organization_type:z.string().max(200).optional(),industry:z.string().max(200).optional(),
    external_reference:z.strictObject({namespace:z.string().regex(/^[a-z][a-z0-9_-]{0,99}$/),id:z.uuid()}).optional()})
    .refine(v=>v.record_type==='individual'?!v.website&&!v.organization_type&&!v.industry:!v.email),
    'Create an individual or organization with only a name. Reuse operation_id after an uncertain response. An optional stable source reference reconciles imported research without merging businesses by website. Does not subscribe, enroll or send.',true,
    v=>request(`/v1/workspaces/${encodeURIComponent(v.workspace)}/contacts?environment=production`,{body:{operationId:v.operation_id,contactKind:v.record_type,displayName:v.name,
      email:v.email,website:v.website,organizationType:v.organization_type,industry:v.industry,
      externalReference:v.external_reference?{namespace:v.external_reference.namespace,id:v.external_reference.id}:undefined},lostResponseEffect:'unknown'}));
  register(MCP_CONTACT_DIRECTORY_TOOLS[5],z.strictObject(record),
    'Read a native contact’s current revision, values, linked people/organizations, lists and sourced research summaries. Read individual research entries for full preserved payloads.',false,
    v=>request(`${path(v)}/records/${encodeURIComponent(v.contact_id)}?environment=production`));
  register(MCP_CONTACT_DIRECTORY_TOOLS[6],z.strictObject({...edit,name:z.string().min(1).max(200).optional(),website:z.url().max(500).nullable().optional(),values:fields.default({})}),
    'Save explicit record properties at the observed revision. Values use field keys and stable option IDs from configuration; null clears a value. Concurrent changes conflict instead of being overwritten.',true,
    v=>call(v,'save_record',{contactId:v.contact_id,expectedRevision:v.expected_revision,displayName:v.name,website:v.website,values:v.values}));
  register(MCP_CONTACT_DIRECTORY_TOOLS[7],z.strictObject({...mutation,person_id:record.contact_id,organization_id:record.contact_id,
    expected_revision:edit.expected_revision,role:z.string().max(200).nullable().optional(),is_primary:z.boolean().default(false),source_url:z.url().max(2000).optional()}),
    'Link a person to an existing organization with a role and optional source. Both records must belong to this workspace; a person may have multiple organizations.',true,
    v=>call(v,'link_contact',{personId:v.person_id,organizationId:v.organization_id,expectedRevision:v.expected_revision,
      role:v.role,isPrimary:v.is_primary,sourceUrl:v.source_url}));
  register(MCP_CONTACT_DIRECTORY_TOOLS[8],z.strictObject({...edit,list_id:z.uuid(),member:z.boolean(),context:z.record(z.string(),z.unknown()).default({})}),
    'Add or remove explicit list membership with optional list-specific research context. Does not grant subscription, associate a campaign or send a message.',true,
    v=>call(v,'set_membership',{contactId:v.contact_id,listId:v.list_id,expectedRevision:v.expected_revision,member:v.member,context:v.context}));
  register(MCP_CONTACT_DIRECTORY_TOOLS[9],z.strictObject({...edit,entry_id:z.string().min(1).max(200),kind:z.enum(['note','evidence','question','inference','import']),
    body:z.string().max(65536),sources:z.array(source).max(100).default([]),observed_at:z.iso.datetime({offset:true}).optional(),
    payload:z.record(z.string(),z.unknown()).default({}),subject_contact_ids:z.array(record.contact_id).min(1).max(100).optional()}),
    'Append immutable sourced research, questions or a preserved import snapshot at the current contact revision. Distinguish evidence from inference. Include every referenced person in subject_contact_ids for erasure ownership; the owning contact must be included.',true,
    v=>call(v,'append_research',{contactId:v.contact_id,expectedRevision:v.expected_revision,entryId:v.entry_id,kind:v.kind,body:v.body,
      sources:v.sources,observedAt:v.observed_at,payload:v.payload,subjectContactIds:v.subject_contact_ids}));
  register(MCP_CONTACT_DIRECTORY_TOOLS[10],z.strictObject({...edit,email:z.email().max(320)}),
    'Attach one encrypted email route to an individual or organization at its observed revision. A company inbox remains an organization route. Existing endpoint ownership and erasure restrictions remain authoritative; no permission or sending effect.',true,
    v=>call(v,'set_email',{contactId:v.contact_id,expectedRevision:v.expected_revision,email:v.email}));
  register(MCP_CONTACT_DIRECTORY_TOOLS[11],z.strictObject({...record,entry_id:z.string().min(1).max(200)}),
    'Read one complete retained research entry, including its original imported payload and source history.',false,
    v=>request(`${path(v)}/records/${encodeURIComponent(v.contact_id)}/entries/${encodeURIComponent(v.entry_id)}?environment=production`));
  register(MCP_CONTACT_DIRECTORY_TOOLS[12],z.strictObject({...workspace,list_id:z.uuid()}),
    'Read all saved definition versions for this workspace contact list without changing its criteria or membership.',false,
    v=>request(`${path(v)}/lists/${v.list_id}?environment=production`));
  register(MCP_CONTACT_DIRECTORY_TOOLS[13],z.strictObject({...mutation,view_id:z.uuid(),name:z.string().min(1).max(200),query:z.record(z.string(),z.unknown()),
    expected_revision:z.number().int().nonnegative(),archived:z.boolean().default(false)}),
    'Save or revise a workspace view using the same camelCase query returned by the contact directory API. Views retain stable field and list IDs through label changes.',true,
    v=>call(v,'define_view',{id:v.view_id,name:v.name,query:v.query,expectedRevision:v.expected_revision,archived:v.archived}));
  register(MCP_CONTACT_DIRECTORY_TOOLS[14],z.strictObject({...record,after:z.string().min(1).max(2048).optional()}),
    'Page the complete retained research history for one contact. Follow nextAfter until null; read individual entries for full bodies, all sources and original payloads.',false,
    v=>request(`${path(v)}/records/${encodeURIComponent(v.contact_id)}/history?environment=production${v.after?'&after='+encodeURIComponent(v.after):''}`));
}
