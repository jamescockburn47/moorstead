# Full-world reset consent — 20 September 2026

Tier A: a full reset affects saved builds, terrain and vehicles. Enforcement is
in the authenticated relay boundary, not just the button. The top HUD now exposes
Full reset, with a confirmation explaining the effect and a shared 1/2 indication.

Exactly two distinct authenticated accounts must be connected and approve the
same action within 30 seconds. A repeat press does not add a vote or extend the
window. Disconnects, membership changes, account device handoff and generation
changes invalidate votes. Every participant's current session is checked before
destructive commit. Replayed approvals and mixed reset/restore votes are refused.

Both reset and checkpoint restoration require approval: unilateral restoration
could otherwise swap an empty checkpoint back into the world. Existing atomic
checkpoint, transaction, vehicle lease release and battle reset paths are reused.
Failed saves do not change terrain and require fresh approval. Knocked-out players
can approve. Consent state is temporary and does not survive a server restart.

The 81-test backend suite passes, including real authenticated WebSocket approvals,
same-account repeats, no writes on first approval, recovery, stale requests,
revocation, mixed actions and save failure. Client checks cover vote validation,
pending-operation isolation and status presentation. Independent review found the
restore bypass and knocked-out-player rejection; both were fixed and the focused
rereview found no remaining material issue. The build and full verification gate
pass. The real two-browser reset journey proves unchanged terrain after one
approval, shared reset after the second, and recovery after matching approvals.
The 800-pixel tablet screenshot confirms the shared approval button is reachable.

The broader touch journey exposed two test preparation/lifecycle issues: aim was
read before the frame applied a prepared camera pose, and the Node WebSocket
bridge could outlive its browser page. Preparation now waits for camera frames;
the fixture closes its upstream socket when the owning page closes. The final
focused reset and portrait/landscape touch browser run passes both journeys.

No production reset, server mutation or deployment occurred. This remains local,
alongside the war upgrade; its live-source reconciliation prerequisite still
applies. Production verification must never clear the boys' world as a probe.
Use the isolated adapter with synthetic accounts for destructive reset/recovery
verification, then check the deployed consent UI without approving a live reset.
