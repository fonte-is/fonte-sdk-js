# Repeat the Broadcast → Return → Action → Results journey

Use this guide to check Broadcast Results against a saved application record.
Start with the [native integration guide](./results.md) and the
[Results reference](./results-reference.md) for identity, timing and delivery
requirements. Application measurement is optional; contact onboarding and
sending do not require it.

## Select the application and controlled people

Choose an application you can sign in to and one controlled recipient, A.
Select an action whose successful result you can reopen, such as saving a
report. Clicking a button or reopening an existing record does not establish a
new successful action.

Use another genuinely authenticated, controlled person, X, for the forwarded
link case. X must be allowed to use the application and measurement, but must
be outside this Broadcast's recipient population. Denying X access tests
permission rejection; it does not test whether two authenticated people are
attributed correctly. Keep the identities and Results you inspect restricted
to the people authorized to see them.

The SDK's Next.js reference has unbound session, report and entitlement ports.
Connect these to the application's existing authentication and saved records
before using it to check Results.

## Connect the application

For **native Fonte**, follow the integration guide: install the supported SDK,
connect the app, identify the current server-authenticated user, and place the
selected trigger after the original successful commit. Verify the operation
independently by reopening its saved state through the application's ordinary
interface. Delivery, retries and optional lifecycle drains stay outside the
successful business response. Configure additional meaningful actions through
the same interface when extending the installation.

If you use **external events**, use the application's existing event pipeline and identified events.
Connect the project through the supported customer interface, select an event
that already means a committed success, and verify its stable user identity
against the same Fonte Contact. Preserve the original operation ID and time.
An anonymous ID, identified profile flag, click or optimistic button event is
insufficient. Run the identical cases below through the same Results engine.
Also observe one real operation through both native Fonte and external delivery: one
Contact must remain one Return and one action, with both sources disclosed.

Record each setup step, code edit, sign-in, permission, credential installation
and wait. Check the available capabilities of your connection before relying
on external delivery. A guide or SDK example alone does not establish that a
connection is available.

## Freeze the answer before Send

For each case, prepare one fresh Broadcast to A through Fonte's ordinary
interface or public MCP tools.
Read its ordinary audience and saved measurement definition before release.
Select a genuine Fonte Link placement when testing Links; retain its actual
destination and copy identity. Do not manufacture a `fl_*` token.

Freeze this independent ledger before executing the case:

| Input         | Record from its ordinary authority                                                                                                              |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Scope         | Application, workspace, environment, source revision, Broadcast and selected trigger key/label.                                                 |
| Recipient     | A's existing Fonte Contact; X's separately verified identity outside the audience.                                                              |
| Expected sets | Which Contacts should be in Returned and in each selected action, with the reason for each inclusion/exclusion.                                 |
| Send boundary | Original authoritative acceptance for A; Send click, delivery and report time cannot replace it. If unavailable, record a timing-proof blocker. |
| Operation     | Original committed operation UUID/time, independently saved application state, or failed response plus unchanged saved state.                   |
| Read boundary | Expected changes and a bounded wait deadline; retain actual Results revision, `asOf`, coverage and all necessary evidence pages.                |

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

| Case                       | Real customer journey                                                                                                                                                             | Independent expected answer                                                                                                       |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Normal                     | A opens the received link, signs in, changes and successfully saves the selected product field. Reopen the saved field.                                                           | Returned={A}, action={A}; counts 1/1. Exact destination and A's action evidence agree.                                            |
| Direct return              | A enters the app directly and signs in without using the message. Stop before a successful action.                                                                                | Returned={A}, action={}; counts 1/0. A later genuine selected commit makes 1/1.                                                   |
| Forwarded/wrong person     | X opens A's received URL and signs in as X. X completes the same genuine operation. A stays idle.                                                                                 | Returned={}, action={} for this Broadcast; counts 0/0. Link activity may exist, but neither X nor A is falsely credited.          |
| Failed action              | A signs in, attempts the selected action and gets a real validation/conflict/save failure. Reopen unchanged saved state.                                                          | Returned={A}, action={}; counts 1/0. An optimistic button event is not success.                                                   |
| No change/repeat           | A repeats the already saved bytes or reads/polls the saved operation.                                                                                                             | No new committed action. Already observed Contact counts remain 1/1; reads never create an action.                                |
| Exact replay               | The supported host retry redelivers the original acknowledged identity/action body, UUID and original time.                                                                       | Counts stay 1/1; the original fact and time remain. A new identify handle is not an exact replay.                                 |
| Late pre-send action       | A actually commits before this Send; the host's existing supported delivery is delayed until afterward.                                                                           | That action contributes no Return or action; counts 0/0 if no other foreground activity occurs. No backdating.                    |
| Late post-send action      | A actually commits in-window; existing supported delivery arrives later with its original identity and time.                                                                      | Eventual 1/1 after custody/publication, without retiming. Preserve the earlier partial/stale snapshot.                            |
| Restart after ACK          | Restart the controlled host or admitted measurement process through its existing lifecycle, then recover/read again.                                                              | Acknowledged facts survive; eventual 1/1, no duplicate rows or half publication.                                                  |
| Loss before ACK            | A's business commit succeeds, then unacknowledged in-memory observation is lost in the controlled host lifecycle.                                                                 | Business success remains. Record the lost observation; a zero count does not establish that no action occurred.                   |
| Measurement unavailable    | Use the host's existing customer configuration to disconnect measurement or make its delivery destination unavailable. Commit a real action. Restore through the supported setup. | App success and admitted Send remain independent. Disclose the gap; recover only facts the supported source can actually recover. |
| Optional external delivery | Repeat normal/direct/wrong/failed/replay cases with selected existing events, then native+external delivery for one operation.                                                    | Same Contact sets and timing rules; unidentified, wrong-user and unsuccessful events add no action. Dual observation stays 1/1.   |

Use the application's existing configuration, lifecycle and retry behavior to
exercise failures. Record a case as untested when those controls cannot
reproduce it. Preserve the original saved operation and its time when retrying.

When payments are connected, freeze the actual merchant, payment/refund IDs,
currency, authoritative collection times and canonical payer match separately.
Compare Results with the independently read provider records. Exact replay
must not duplicate an economic payment; a completed refund must correct its
original payment once. Keep currencies separate and failed/pending payments
out of collected money. SDK actions never establish monetary truth.

## Record every step and compare

Use one restricted record per run, with actual timestamps and elapsed durations.
Record customer steps before they happen so omitted setup/repair is visible.
Keep server keys, bearer tokens and browser identity tokens out of that record;
minimize captured application/recipient data and restrict its access.

| Field                        | Meaning                                                                                                                                |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `runId`, `case`, `setupPath` | Fresh run identity; selected case; native or external delivery.                                                                        |
| `expected`, `observed`       | Independently frozen Contact sets/counts and actual Results, including coverage/revision/as-of.                                        |
| `steps[]`                    | Step name, ordinary interface, start/end UTC, elapsed milliseconds, active milliseconds and wait milliseconds.                         |
| `failures[]`                 | Actual failed step/response, confusing displayed state, independent counterevidence and retry outcome.                                 |
| `interventions[]`            | Who intervened, what they changed, why, elapsed time, and whether an ordinary customer could do it.                                    |
| `performance`                | App commit/readback time, Broadcast preparation and release time, delivery wait, action-to-visible-Results wait and impact on sending. |
| `outcome`, `blockers[]`      | PASS, FAIL or NOT RUN for this exact case, and unresolved prerequisites.                                                               |

Compare the saved app state and authenticated person first, then the canonical
Send boundary and Results summary/evidence. Preserve every mismatch and
pre-repair snapshot. Correct the cause and rerun without changing the expected
answer to match Fonte. Set a wait deadline and record delayed or unavailable
Results as such.

Delivery and click totals are separate from Return and Action Results. Check
the application's saved record, the authenticated person and the Results
evidence together. Repeat the applicable cases for any optional external
connection you enable, and retain unresolved mismatches for investigation.
