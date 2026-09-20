# War and shared reset release — 20 September 2026

Release candidate: app 1.1.76 / content 7, SQLite schema 4. Built in an isolated
checkout from live release 1.1.75, preserving readiness, reconnect pause, forfeit
and vehicle starter flows. The original development checkout remains untouched.

Zone capture counts living grounded players or soldiers within three horizontal
metres, regardless of flag height. Infantry gradually breach blocking walls using
small durable, shared, undoable terrain commits. Ten recruits every 25 seconds,
three separately commanded squads, troop waves, health bars, turrets and firing
tanks complete the war changes. Resources are deferred; cooldowns and caps limit
recruitment/equipment without adding a separate gathering loop.

Full reset and checkpoint restore require two distinct connected authenticated
players approving the same action within 30 seconds. Both can jointly end an active
round. A single or repeated approval never clears the world. Existing checkpoint
recovery is retained. No production world reset is part of deployment.

Pre-release: Free Play headless gate passed (92 backend tests); three owned browser
journeys passed in 36.2s, covering battle readiness/orders, visible two-player
reset/recovery and the war renderer. Independent review found and fixed tanks
Defending the command location instead of their flag; six focused tactics tests
passed, including that added regression. Full canonical verification runs again
inside npm run deploy.

Backend staging: /home/james/moorstead/freeplay-war-20260920-zone-reset. Exact live
source hashes and staged FastAPI startup/shutdown passed. The guarded installer
backs up the stopped SQLite world, rehearses startup against a copy and requires
all nine saved table hashes to remain unchanged. Rollback restores the previous
adapter source and removes the three new modules, preserving the live database.
Previous client deployment: moorcraft-im11jb85y-james-cockburns-projects.vercel.app.
Final live results are appended after installation. Physical tablet performance
has not been measured in this release.

## Live result

PASS: app **1.1.76 / content 7** shipped through `npm run deploy`; full canonical
verification (93 backend tests) and production build passed. Implementation
`04a9952`, release `f15111f`; deployment
`moorcraft-avd5jfe0e-james-cockburns-projects.vercel.app`. The general stack probe
confirmed 1.1.76 then encountered the deliberately disabled NPC brain (HTTP 502).
Brain/model services remain off; relay and dashboard are active.

Backend commit `aa0ab3b`: all 16 installed module hashes match the staged release.
All nine saved tables remained identical: 739,625 active cells, 11 vehicles,
377,822 checkpoint cells and 16 checkpoint vehicles. Epoch 5 / revision 10801
remained unchanged. Integrity-checked backup:
`/home/james/moorstead/freeplay-war-20260920-zone-reset/before/world.sqlite3`.

Public browser probe passed actual login, visible Full reset, zone objective,
vehicle choices, army join, flag readiness, ten automatic-Attack recruits,
recruit cooldown, separate group controls, turret/tank controls, leave and sign
out. Zero page/protocol errors or terrain mutations; revision stayed 10801.
Disposable invite, account and sessions were revoked, and local credentials were
removed. The first two smoke attempts exposed probe-only expected-count and UTF-8
transcription errors; corrected probe then passed. No product change was needed.
Evidence is retained under the release checkout's ignored `tests/.artifacts/`:
`freeplay-warflow-live-result.json`, `warflow-probe-cleanup.json`,
`war-postcheck.json`, `war-deploy.log` and `war-backend-install.log`.

Both players should refresh before playing. Actual combat/capture and joint
reset/restore were exercised against the isolated real adapter; the live smoke
preserved the boys' world. Physical Fire tablet performance remains unmeasured.
