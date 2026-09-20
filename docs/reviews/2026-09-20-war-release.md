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
