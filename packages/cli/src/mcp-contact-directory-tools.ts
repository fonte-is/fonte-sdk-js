import { z } from "zod";
import type { CoreRequester } from "./operator-core-request.js";

export const MCP_CONTACT_DIRECTORY_TOOLS = [
  "fonte_read_contact_configuration","fonte_define_contact_field","fonte_define_contact_list",
  "fonte_find_contacts","fonte_create_contact","fonte_read_contact","fonte_update_contact",
  "fonte_link_contact","fonte_set_contact_list_membership","fonte_append_contact_research",
  "fonte_set_contact_email","fonte_read_contact_research","fonte_read_contact_list_history",
  "fonte_define_contact_view","fonte_list_contact_research",
  "fonte_stop_organization_outreach",
  "fonte_save_contact_context",
  "fonte_list_contact_timeline","fonte_read_contact_milestone","fonte_save_contact_milestones",
] as const;
type Register = (name:string,schema:z.ZodType,description:string,mutation:boolean,operation:(input:any)=>Promise<unknown>)=>void;
const value=z.union([z.string(),z.number().finite(),z.boolean(),z.array(z.string()).max(100),z.null()]);
const fields=z.record(z.string().regex(/^[a-z][a-z0-9_]{0,99}$/),value);
const filter=z.strictObject({field:z.string().regex(/^[a-z][a-z0-9_]{0,99}$/),operator:z.enum(['is','is_any_of','is_empty']),value:value.optional()});
const choice=z.strictObject({id:z.string().min(1).max(200),label:z.string().min(1).max(200),archived:z.boolean().default(false)});
const field=z.strictObject({key:z.string().regex(/^[a-z][a-z0-9_]{0,99}$/),label:z.string().min(1).max(200),
  type:z.enum(['string','number','boolean','date','datetime','select','multiselect']),
  applies_to:z.enum(['any','individual','organization']).default('any'),choices:z.array(choice).max(500).default([]),state:z.enum(['active','archived','deleted']).default('active')});
const source=z.strictObject({url:z.url().max(1000).refine(v=>{const u=new URL(v);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password;}),
  title:z.string().trim().min(1).max(120).optional(),published_at:z.string().max(40).optional(),observed_at:z.string().max(40).optional()});
const wordCount=(text:string)=>[...new Intl.Segmenter('en',{granularity:'word'}).segment(text)].filter(part=>part.isWordLike).length;
const context=z.strictObject({brief:z.string().max(1800),
  findings:z.array(z.strictObject({id:z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,79}$/),text:z.string().trim().min(1).max(240),sources:z.array(source).min(1).max(3)})).max(5),
  questions:z.array(z.string().trim().min(1).max(200)).max(3),next_action:z.string().max(240)})
  .refine(v=>wordCount([v.brief,...v.findings.map(f=>f.text),...v.questions,v.next_action].join(' '))<=150,
    'Keep context, findings, questions and next action within 150 words in total.');
const sourceBody=(s:z.infer<typeof source>)=>({url:s.url,title:s.title,publishedAt:s.published_at,observedAt:s.observed_at});
const milestoneDate=z.string().regex(/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/).nullable();
const milestone=z.strictObject({id:z.uuid(),expected_revision:z.number().int().nonnegative(),occurred_on:milestoneDate,
  title:z.string().trim().min(1).max(100).refine(v=>wordCount(v)<=12,'Keep titles within 12 words.'),detail:z.string().trim().max(800).default(''),
  sources:z.array(source).min(1).max(3),highlight:z.boolean(),archived:z.boolean().default(false),subject_contact_ids:z.array(z.string().min(1).max(200)).min(1).max(20).optional()})
  .refine(v=>wordCount(`${v.title} ${v.detail}`)<=40,'Keep each milestone title and detail within 40 words in total.')
  .refine(v=>!/[\p{Cc}\p{Cf}]/u.test(v.title+v.detail),'Use plain text without control or invisible formatting characters.');

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
    'Read one contact’s current concise context, up to five timeline highlight headlines, revision, values, relationships and lists. Company context stays linked. Read milestone evidence explicitly; preserved research and corrections remain available through fonte_list_contact_research and fonte_read_contact_research.',false,
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
  register(MCP_CONTACT_DIRECTORY_TOOLS[9],z.strictObject({...edit,entry_id:z.string().min(1).max(200),kind:z.literal('note'),
    body:z.string().trim().min(1).max(600).refine(v=>wordCount(v)<=80,'Keep activity within 80 words.'),sources:z.array(source).max(3).default([]),observed_at:z.iso.datetime({offset:true}).optional(),
    payload:z.strictObject({}).default({}),subject_contact_ids:z.array(record.contact_id).min(1).max(100).optional()}),
    'Record one brief decision or meaningful activity, at most 80 words. Exact duplicate notes are ignored. Use fonte_save_contact_context for current findings, questions and the next action. Raw payloads and new research imports are rejected; existing history remains readable. Include referenced people for erasure ownership.',true,
    v=>call(v,'append_research',{contactId:v.contact_id,expectedRevision:v.expected_revision,entryId:v.entry_id,kind:v.kind,body:v.body,
      sources:v.sources.map(sourceBody),observedAt:v.observed_at,payload:v.payload,subjectContactIds:v.subject_contact_ids}));
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
  register(MCP_CONTACT_DIRECTORY_TOOLS[15],z.strictObject({...edit,requested_by:z.string().trim().min(1).max(200),
    request:z.string().trim().min(1).max(4000),whole_organization:z.literal(true)}),
    'Record an explicit organization-wide stop request. Blocks SMTP correspondence to the organization and its linked contacts across campaigns, without changing personal newsletter subscriptions. Requires an organization and its current revision. Reuse operation_id after an uncertain reply; only enforcement=enforced confirms queued SMTP is fenced. Never sends a message.',true,
    v=>call(v,'stop_organization_outreach',{contactId:v.contact_id,expectedRevision:v.expected_revision,requestedBy:v.requested_by,request:v.request,wholeOrganization:v.whole_organization}));
  register(MCP_CONTACT_DIRECTORY_TOOLS[16],z.strictObject({...edit,context,subject_contact_ids:z.array(record.contact_id).min(1).max(100).optional()}),
    'Replace this contact’s current working context: 150 words TOTAL across brief, up to five sourced findings, up to three open questions and one next action. Use stable finding IDs; keep shared company facts on the organization. Replaced versions are preserved automatically in History. Identical saves create no version. Include every referenced person for erasure ownership. No subscription or sending effect.',true,
    v=>call(v,'save_context',{contactId:v.contact_id,expectedRevision:v.expected_revision,context:{brief:v.context.brief,
      findings:v.context.findings.map((f:z.infer<typeof context>['findings'][number])=>({...f,sources:f.sources.map(sourceBody)})),
      questions:v.context.questions,nextAction:v.context.next_action},subjectContactIds:v.subject_contact_ids}));
  register(MCP_CONTACT_DIRECTORY_TOOLS[17],z.strictObject({...record,after:z.string().min(1).max(2048).optional(),if_revision:edit.expected_revision.optional()}),
    'Read ten sourced milestones from this contact’s timeline in chronological order. Follow nextAfter for more. Event dates preserve known year/month/day precision; null means unknown. if_revision skips unchanged first-page reads. A changed record invalidates old page cursors. Company events stay on the company record.',false,
    v=>request(`${path(v)}/records/${encodeURIComponent(v.contact_id)}/timeline?environment=production${v.after?'&after='+encodeURIComponent(v.after):''}${v.if_revision?'&ifRevision='+encodeURIComponent(v.if_revision):''}`));
  register(MCP_CONTACT_DIRECTORY_TOOLS[18],z.strictObject({...record,milestone_id:z.uuid()}),
    'Read one current milestone with its source references, precise known event date, recorded time and revision. Use the ID from the contact’s highlights instead of loading all research.',false,
    v=>request(`${path(v)}/records/${encodeURIComponent(v.contact_id)}/timeline/${v.milestone_id}?environment=production`));
  register(MCP_CONTACT_DIRECTORY_TOOLS[19],z.strictObject({...edit,milestones:z.array(milestone).min(1).max(5)})
    .refine(v=>new Set(v.milestones.map(m=>m.id)).size===v.milestones.length,'Update each milestone once per request.')
    .refine(v=>v.milestones.every(m=>!m.subject_contact_ids||m.subject_contact_ids.includes(v.contact_id)),'Every milestone must include this contact in its erasure subjects.'),
    'Save one to five material milestones, each at most 40 words including a title of at most 12 words/100 characters, with one to three public source links. Use YYYY, YYYY-MM, YYYY-MM-DD or null without inventing a day. At most five active highlights per contact. Correct existing stable IDs at their current revisions; 0 creates. Earlier versions remain in History. Include referenced people for erasure. Reuse operation_id after uncertainty. No sending or subscription effect.',true,
    v=>call(v,'save_milestones',{contactId:v.contact_id,expectedRevision:v.expected_revision,milestones:v.milestones.map((m:z.infer<typeof milestone>)=>({id:m.id,expectedRevision:m.expected_revision,
      occurredOn:m.occurred_on,title:m.title,detail:m.detail,sources:m.sources.map(sourceBody),highlight:m.highlight,archived:m.archived,subjectContactIds:m.subject_contact_ids}))}));
}
