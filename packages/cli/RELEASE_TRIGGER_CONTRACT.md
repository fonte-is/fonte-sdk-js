# Repository push trigger contract

The event adapter accepts one normalized event only after its provider-specific
authenticator verifies the delivery. The normalized shape is:

```json
{
  "schemaVersion": "fonte.repository_push.v1",
  "deliveryId": "provider-delivery-id",
  "repository": { "url": "https://git.example.test/org/repo.git" },
  "ref": "refs/heads/main",
  "before": "0000000000000000000000000000000000000000",
  "after": "0123456789abcdef0123456789abcdef01234567",
  "receivedAt": "2026-09-24T12:00:00.000Z"
}
```

The adapter compares the authenticated repository URL with both its configured
repository and the checkout's `origin`. For `refs/heads/main` it calls the
installed `fonte release --source <after>` command, which delegates to the same
targetless FON-659 runtime as manual `fonte release`. For other branch refs it
hands the unchanged event to the candidate qualification consumer. FON-749 can
consume that same event contract; it does not need a second webhook or a second
release engine. `deliveryId` is trace metadata, not a release request key.

The thinnest independent ingress is one CodeBuild repository webhook connected
through AWS CodeConnections and filtered for `PUSH` on `refs/heads/*`. It
normalizes the provider delivery to this event and dispatches by `ref`: main to
release, other branches to qualification. The project must use a trusted
buildspec/runtime installation outside the pushed candidate tree. GitHub
Actions may emit the same normalized event, but the CodeBuild webhook remains an
independent path to the same adapter. The adapter itself has no GitHub or AWS
dependency.

The live account readback found no CodeConnections. Before this ingress can be
activated, a GitHub organization administrator must authorize the AWS
CodeConnections GitHub App for the Core repository and the resulting connection
must be supplied to the CodeBuild project. No AWS resource is created by this
package.

Identity limit: the event carries the exact `(canonical repository URL, after
SHA)` pair and invokes the same manual CLI path. The currently installed FON-659
runtime generates its persisted `requestId` with `randomUUID()` for every
invocation. Therefore separate manual and automatic invocations of the same
commit do not yet receive the same persisted request UUID. FON-659 must accept
a deterministic request ID derived from this pair before that stronger identity
claim is true; this adapter does not replace or emulate that runtime behavior.
