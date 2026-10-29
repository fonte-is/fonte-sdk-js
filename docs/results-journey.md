# Repeat the Broadcast → Return → Action → Results journey

Use this run packet with the [native integration guide](./results.md). It is a
customer journey and an independent comparison record, not another tracking
engine or a passing test receipt. A case remains **NOT RUN** until the real
application, Broadcast, committed operation and visible Results are recorded.

The independent semantic basis is the existing
[native contract](https://github.com/fonte-is/fonte-core/blob/f07cf1bfe935650d286398e00786540f386e4722/docs/fon910-native-results-contract.md)
and [named-trigger oracle](https://github.com/fonte-is/fonte-core/blob/f07cf1bfe935650d286398e00786540f386e4722/test/fixtures/post-broadcast-outcomes/fon916-named-trigger-expectations.json).
Their controlled receipts are regression evidence, not real customer proof.

## Select the application and controlled people

Start with Fonte itself and one controlled recipient, A. The existing Fonte
adapter measures an original committed subject change as
`broadcast_draft_saved`, a committed body change as `broadcast_content_saved`,
and a new completed contacts import as `contacts_imported`. Use the ordinary
subject or content editor for the first action. Reopening a draft, clicking a
button, creating an empty draft or signing up alone does not prove that action.

Use another genuinely authenticated, controlled person, X, for the forwarded
link case. X must be allowed to use the application and measurement, but must
be outside this Broadcast's recipient population. Denying X access tests
permission rejection; it does not test whether two authenticated people are
attributed correctly. Keep real identities and receipts in a private run record.

Then repeat first-time setup on a fresh controlled application with existing
authentication and a durable product operation. The SDK's Next.js reference
has unbound session, report and entitlement ports; it is not that application.
Use the host's existing authentication and committed operation/readback. Do
not add a substitute identity system or fabricate a business success.

## Measure the two setup paths separately

For **native Fonte**, follow the integration guide: install the supported SDK,
connect the app, identify the current server-authenticated user, and place the
selected trigger after the original successful commit. Verify the operation
independently by reopening its saved state through the application's ordinary
interface. Delivery, retries and optional lifecycle drains stay outside the
successful business response. Configure additional meaningful actions through
the same interface when qualifying the broader installation.

For **PostHog**, use the application's existing project and identified events.
Connect the project through the supported customer interface, select an event
that already means a committed success, and verify its stable user identity
against the same CSV Contact. Preserve the original operation ID and time.
An anonymous ID, identified profile flag, click or optimistic button event is
insufficient. Run the identical cases below through the same Results engine.
Also observe one real operation through both native Fonte and PostHog: one
Contact must remain one Return and one action, with both sources disclosed.

Record each setup step, code edit, sign-in, permission, credential installation,
wait and intervention. A private artifact handoff or operator configuration is
an intervention. The current native candidate is privately packaged; the
current guide establishes neither public npm installation nor a released
Connect PostHog path. Record unavailable interfaces as blockers, not completed
customer steps.

## Freeze the answer before Send

For each case, prepare one fresh Broadcast to A through the public Fonte MCP.
Read its ordinary audience and saved measurement definition before release.
Select a genuine Fonte Link placement when testing Links; retain its actual
destination and copy identity. Do not manufacture a `fl_*` token.

Freeze this independent ledger before executing the case:

| Input | Record from its ordinary authority |
| --- | --- |
| Scope | Application, workspace, environment, source revision, Broadcast and selected trigger key/label. |
| Recipient | A's existing CSV Contact; X's separately verified identity outside the audience. |
| Expected sets | Which Contacts should be in Returned and in each selected action, with the reason for each inclusion/exclusion. |
| Send boundary | Original authoritative acceptance for A; Send click, delivery and report time cannot replace it. If unavailable, record a timing-proof blocker. |
| Operation | Original committed operation UUID/time, independently saved application state, or failed response plus unchanged saved state. |
| Read boundary | Expected changes and a bounded wait deadline; retain actual Results revision, `asOf`, coverage and all necessary evidence pages. |

One Contact counts once independently for Returned and each configured action.
A successful configured action also establishes Return. First identify after
Send is supported; a message link never establishes the authenticated person.
Use original action time strictly after acceptance and within the inclusive
seven-day window. A later receipt cannot make a pre-send operation qualify.

Fresh Broadcasts exclude earlier actions, but their observation windows can
overlap. Freeze each case's Results snapshot before the next recipient action.
A later real action may legitimately change an older Broadcast. Compare the
independently known facts through the report's actual `asOf`; do not rewrite
the earlier expected answer or require old observed-zero snapshots forever.
Unexpected navigation or activity is a recorded scenario deviation. Retain
the mismatch, correct the scenario and run a newly frozen case.

## Execute normal and adverse cases

The table uses fresh single-recipient Broadcasts and no unrelated A activity
through the selected `asOf`. Empty sets mean observed zero under the source's
actual coverage; they do not establish complete absence of activity.

| Case | Real customer journey | Independent expected answer |
| --- | --- | --- |
| Normal | A opens the received link, signs in, changes and successfully saves the selected product field. Reopen the saved field. | Returned={A}, action={A}; counts 1/1. Exact destination and A's action evidence agree. |
| Direct return | A enters the app directly and signs in without using the message. Stop before a successful action. | Returned={A}, action={}; counts 1/0. A later genuine selected commit makes 1/1. |
| Forwarded/wrong person | X opens A's received URL and signs in as X. X completes the same genuine operation. A stays idle. | Returned={}, action={} for this Broadcast; counts 0/0. Link activity may exist, but neither X nor A is falsely credited. |
| Failed action | A signs in, attempts the selected action and gets a real validation/conflict/save failure. Reopen unchanged saved state. | Returned={A}, action={}; counts 1/0. An optimistic button event is not success. |
| No change/repeat | A repeats the already saved bytes or reads/polls the saved operation. | No new committed action. Already observed Contact counts remain 1/1; reads never create an action. |
| Exact replay | The supported host retry redelivers the original acknowledged identity/action body, UUID and original time. | Counts stay 1/1; the original fact and time remain. A new identify handle is not an exact replay. |
| Late pre-send action | A actually commits before this Send; the host's existing supported delivery is delayed until afterward. | That action contributes no Return or action; counts 0/0 if no other foreground activity occurs. No backdating. |
| Late post-send action | A actually commits in-window; existing supported delivery arrives later with its original identity and time. | Eventual 1/1 after custody/publication, without retiming. Preserve the earlier partial/stale snapshot. |
| Restart after ACK | Restart the controlled host or admitted measurement process through its existing lifecycle, then recover/read again. | Acknowledged facts survive; eventual 1/1, no duplicate rows or half publication. |
| Loss before ACK | A's business commit succeeds, then unacknowledged in-memory observation is lost in the controlled host lifecycle. | Business success remains. Missing Results are partial/unavailable; never manufacture 1/1 or measured zero. |
| Measurement unavailable | Use the host's existing customer configuration to disconnect measurement or make its delivery destination unavailable. Commit a real action. Restore through the supported setup. | App success and admitted Send remain independent. Disclose the gap; recover only facts the supported source can actually recover. |
| PostHog alternatives | Repeat normal/direct/wrong/failed/replay cases with selected existing events, then native+PostHog for one operation. | Same Contact sets and timing rules; unidentified, wrong-user and unsuccessful events add no action. Dual observation stays 1/1. |

Use existing customer configuration, lifecycle and retry behavior for faults.
Do not invoke internal intake with invented observations, edit a database,
patch a private journal or create a test-only authority. If a customer interface
cannot perform a fault/replay, record that case as blocked. Installed service
fault qualification remains a separate operator exercise through the existing
release owner; it cannot be reported as a customer step or routine setup repair.

When Stripe is connected, freeze the actual merchant, payment/refund IDs,
currency, authoritative collection times and canonical payer match separately.
Compare Results with the independently read provider records. Exact replay
must not duplicate an economic payment; a completed refund must correct its
original payment once. Keep currencies separate and failed/pending payments
out of collected money. SDK actions never establish monetary truth.

## Record every step and compare

Use one private record per run, with actual timestamps and monotonic durations.
Record customer steps before they happen so omitted setup/repair is visible.
Keep server keys, bearer tokens and browser identity tokens out of that record;
minimize captured application/recipient data and restrict its access.

| Field | Meaning |
| --- | --- |
| `runId`, `case`, `setupPath` | Fresh run identity; selected case; native or PostHog. |
| `expected`, `observed` | Independently frozen Contact sets/counts and actual Results, including coverage/revision/as-of. |
| `steps[]` | Step name, ordinary interface, start/end UTC, elapsed milliseconds, active milliseconds and wait milliseconds. |
| `failures[]` | Actual failed step/response, confusing displayed state, independent counterevidence and retry outcome. |
| `interventions[]` | Who intervened, what they changed, why, elapsed time, and whether an ordinary customer could do it. |
| `performance` | App commit/readback time, MCP order-to-release time, delivery wait, action-to-visible-Results wait and measured overlap with admitted Send. |
| `outcome`, `blockers[]` | PASS, FAIL or NOT RUN for this exact case, and unresolved prerequisites. |

Compare the saved app state and authenticated person first, then the canonical
Send boundary and Results summary/evidence. Preserve every mismatch and
pre-repair snapshot. Fix material friction in its existing owner and rerun;
do not change the expected answer to match Fonte. Use bounded reads/waits and
the existing polling behavior, not a new background runner or analytics system.

For Fonte product operations use the public MCP inventory. Required existing
capabilities are app-source read/configuration, frozen Results definition
read/bind, normal Broadcast release and bounded Results/evidence reads.
Delivery/click totals alone do not supply Return/action Results. Missing MCP
wrappers or unavailable runtime are product gaps; an internal REST call does
not make an MCP-only run pass. Use the actual inbox and application in the
authorized browser for human clicks, sign-in and committed actions.

Finish only after both setup paths and the supported real/adverse journeys
produce independently correct Results, without manual engineering repair or
material app/Send impact. Report measured friction, verified outcomes and
remaining blockers. UX review follows the completed journey.
