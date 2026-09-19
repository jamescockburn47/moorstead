# Free Play flow repair — 19 September 2026

## User report (unchanged)

> they made thier bases, recruited soldiers, couldnt shoot each others and the armies werent fighting. when you leave the army area they disappears. they cant build cars of planes, it says 'add a corner and nthing else happens.. we need to make this all much clearer instruciotns wise, and cnosider the flow. i think there should be a designated warzone that you cant leave until its over. and that creating planes and tanks etc should be much better. there should also be a kuch more intuitive way for the soldiers to fight, and that there needs to be a way to get a strategic advantage somehow by the way you build.

## Agreed scope and implementation decisions

This continues the authorised private Free Play battle/vehicle work. Preserve the
current shared terrain and saved vehicles. Ordinary Moorstead is outside scope.
Desktop and a decent Fire tablet remain the control/performance targets.

The representative playable section is one two-player flag battle and one
build-to-drive vehicle journey. The following are implementation decisions derived
from the user's report, not extra user-authored requirements:

- Mark the existing 128×128 arena with a visible boundary and tactical map.
- Make setup, ready, active combat, reconnection pause and victory explicit.
  One **Place flag & ready** action selects the current base if needed. Both
  teams ready starts the round; ordinary buildings alone are not flags.
- Recruit soldiers with Attack selected. They advance and engage automatically
  after setup. Defend our flag, Follow me and Hold are deliberate alternatives.
- Keep players in an active battle until a capture or an explicit forfeit.
  Retain armies during a 60-second connection grace period; pause combat fairly.
- Give player-confirmed hits visible feedback and explain shields versus health.
- Automatically highlight connected authored blocks from a Vehicle control,
  show a count and Convert action, and retain manual selection as advanced use.
  Starter designs use the existing Car/Plane/Submarine movement modes; the tank
  body uses car controls and does not claim a separate working cannon.
- Teach strategic cover with the existing trenches, sandbags, bunkers and
  watchposts. Prove damage differences rather than infer them from appearance.

## Mechanism findings

The previous browser test fired into the sky and asserted a shot event. That
proved dispatch, not usable combat. It is insufficient for this reported problem.

On the actual generated battlefield, two default Follow armies moved only around
their camps and produced zero hits in 60 simulated seconds. The same armies with
Attack produced their first damaging hit after about 7.5 simulated seconds.
The default camps are 93m apart with terrain obstructing their direct line of sight.
At a clear 20m position, a player shot reduced shield, repeated shots knocked out
the opponent, and inserted cover stopped the identical shot.

The vehicle modal showed Start highlighting without a Convert action and hid
the world Mark corner button it depended on. This was reproduced through input
and inspected in a screenshot before changing the flow.

## Acceptance and evidence status

- Backend: real generated-terrain default armies must advance, damage and score;
  aimed player shots must knock out; cover must block and removal restore damage.
- Browser: both players use actual ready controls; ordinary held Fire reduces
  opponent health; actual wall placement changes the result; default soldiers hit.
  Any route preparation or synthetic peer is disclosed in the test.
- Vehicles: actual selection, Convert, enter, motion, park, saved reconnect and
  editing. Procedural terrain and disconnected extras must never be swept in.
- Flow: active exit and world-reset bypasses refused, explicit forfeit works,
  temporary disconnect preserves army, return resumes, expiry ends the round.
- Release: full canonical gate, fresh independent review, data-preserving backend
  install, public login/core-action check and revocation of temporary probe access.

## Verified implementation

The backend's 82 tests pass, including 35 focused battle tests. Fresh independent
review identified and closed a replacement-socket cleanup race and paused local
movement. The staged installer passed the actual FastAPI startup lifecycle and a
copy of the live database without changing any of its nine saved tables.

The manual vehicle browser journey passed selection, conversion, visible Enter,
flight, parking, another account's editing, undo and reconnect. The touch starter
journey passed a 29-block plane and 31-block car through placement, conversion,
entry, movement and parking without losing cells. Layout checks include 800×600.
Screenshots exposed hidden forward actions and stale placement instructions;
Convert and Enter are now prominent and the status describes the current action.
Starter aiming skips heather while ordinary block editing still targets plants.

Both final battle browser journeys passed after the cooldown and layout fixes.
The opponent walked 85 supported one-metre steps with no server corrections.
Ordinary held Fire stripped the shield and reduced health from 100 to 92; behind
the placed wall health stayed at 80 with zero new hits. Removing it restored hits.
Both default squads advanced more than 12m and produced three soldier-sourced
damaging hits before the proof snapshot. Four jitter-related shot rate limits
were handled without an error overlay; there were no other server refusals.
Exact camera aim and one synthetic network peer are disclosed test preparation.
The screenshot shows the battle status, troops, gun and unobstructed controls.
Evidence is retained in `tests/.artifacts/battle-flow-final/` and
`tests/.artifacts/vehicle-ux-evidence/` (ignored local artifacts).

Physical Fire hardware and the children's independent comprehension still require
their own play session. Starter tanks have a decorative turret; driving remains
outside battle mode, and this release does not introduce a firing tank cannon.

## Release result

Production **1.1.75 / content 6** shipped on 19 September 2026 through
`npm run deploy`: full canonical verify (including 82 backend tests) and build
passed. Implementation commit `47ce970`, release commit `77202e1`, deployment
`moorcraft-im11jb85y-james-cockburns-projects.vercel.app`.
The general post-deploy probe stopped at the deliberately disabled NPC brain's
HTTP 502; the separate live Free Play journey below passed. Brain/model services
were not started.

The guarded backend install at
`/home/james/moorstead/freeplay-war-20260919T144900Z` backed up and preserved all
nine saved tables exactly, including 76,572 active cells and the 5,366,012-cell,
two-vehicle recovery checkpoint. Epoch 3 / revision 4784 stayed unchanged. Schema
remains 4. All 13 installed module hashes match the release source. EVO commit
`3880785`; the stage contains the backup and manifest. No world reset was run.

The public browser probe passed actual login → Vehicles choices → empty arena
join → strategic help → Place flag & ready → six automatic-Attack soldiers →
leave → sign out. Mega/atom choices were absent, grenade present. No page or
protocol errors, no terrain writes, and revision 4784 stayed unchanged. Departure
cleared the temporary army, flags and readiness. Its invite, account and sessions
were revoked and the local credential file removed. Evidence is in the root
workspace's ignored `tests/.artifacts/freeplay-warflow-live-result.json` and
`warflow-probe-cleanup.json`.

Both existing Free Play tabs must refresh to load content 6. Live combat damage
and vehicle driving were verified through the real adapter's isolated browser
journeys; the production smoke deliberately did not damage the boys' world.
