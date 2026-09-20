# In-game Free Play guide — 20 September 2026

Live app 1.1.77, content 7 unchanged. Implementation 369d3a1; release 8ea2069.
Deployed through npm run deploy to
moorcraft-m05ahr1gr-james-cockburns-projects.vercel.app. No backend update or world
mutation was required. Original development checkout remains untouched.

The visible Guide button opens eleven topics with numbered instructions, key
rules, tips, a chapter picker and Previous/Next navigation. Menu → How to play
and Army → Battle guide provide alternate entries. Replaced obsolete six-recruit
and carry-the-flag instructions with current squads, zones, waves, equipment and
two-player reset/recovery rules. Weapon/bomb descriptions use the actual catalogue.

Independent source review checked gameplay instructions and navigation. Corrected
the plasma/machine-gun terrain descriptions to distinguish outside-battle effects
from combat. Included shield regeneration and Return to home base guidance.

Proof: canonical verify passed, including 93 backend tests and the new guide guard;
production build passed. Three browser tests passed in 24s: complete guide journey,
held-touch Fire cancellation and all HUD controls remaining reachable. All eleven
chapters, keyboard navigation, modal exit/resume and unchanged world revision were
checked. Screenshots at 360x800 and 1024x768 were inspected: legible text, clear
headings, numbered steps, usable chapter picker and no horizontal clipping.
Layouts also checked at 800x600 and 640x360. Physical tablet hardware was not tested.

Public first-use probe passed real login → Guide → all eleven chapters → capture
instructions → 360px layout → sign out. No page/protocol errors or terrain writes;
revision remained 10801. Disposable invite/account/sessions revoked and local
credentials removed. Evidence is in ignored tests/.artifacts/guide-live-result.json,
guide-live-360.png, guide-browser.log and guide-deploy.log. The general live probe
confirmed 1.1.77 then stopped at the intentionally disabled NPC brain (HTTP 502);
Free Play itself passed its dedicated public probe.
