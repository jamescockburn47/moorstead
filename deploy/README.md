# Serving Moorstead from the EVO X2

> **Current flow (2026-06) — read this first.** The original one-box walkthrough below is historical; ports and the model have since moved. Today:
> - **Public client is on Vercel** — `npx vercel deploy --prod --yes` from the repo root, after `npm run verify` (13 checks) + `npm run build`. The EVO's `~/moorstead/game` static mirror is **dormant**; Vercel is canonical.
> - **The EVO runs the backend services**, reached via the `sovren-cloudflared` tunnel + Caddy on **:8090**:
>   - `/brain/*` → villager **brain** `moorstead-brain` (FastAPI **:8010**) → llama.cpp **:8086** (gemma MoE, not Ollama).
>   - `/ws` → multiplayer **relay** `moorstead-world` (**:8096**).
>   - `/dash/*` → **dashboard** `moorstead-dash` (**:8095**, LAN/Tailscale-only; only `/ping`, `/auth/claim`, `/visit`, and `/request-invite` are tunnelled).
>   - **Merlin** = `clint-body` + `clint-body-bairns` services.
> - **Editing the off-repo services** (brain, relay, dash): keep local working copies under `C:\Users\James\moorstead-evo-work\`, edit + test there, `cp x x.bak-YYYYMMDD-tag` on the EVO, `scp` back, `sudo systemctl restart <service>`, smoke-test. `ssh evo-tailscale`, passwordless sudo.
> - **Debug:** client loads but login/chat fails ⇒ check `systemctl is-active sovren-cloudflared` FIRST (login `/dash` + relay `/ws` both ride the tunnel).
>
> Day-to-day deploy table: repo `README.md`. Canonical host/port/model detail: the `moorcraft-evo-stack` memory. The walkthrough below is the original from-scratch install (Ollama, Caddy :8080) — keep it for a rebuild, not daily deploys.

The whole stack runs on the one box:

```
Internet ── Cloudflare Tunnel ──> Caddy :8080 ─┬─ /            static game (dist/)
                                               └─ /brain/*  ──> FastAPI brain :8000 ──> Ollama :11434
```

The game itself runs entirely in each visitor's browser (worlds save to their
own IndexedDB). The only shared resource is the villager brain — and every
browser gets its own NPC relationships via a per-visitor id, so memories never
cross.

## 1. Copy the projects over

From the Windows laptop (PowerShell — `tar` is built in):

```powershell
cd C:\Users\James\Desktop
tar -czf moorstead.tgz --exclude=node_modules --exclude=dist Moorcraft
cd "C:\Users\James\Desktop\Games\H games"
tar -czf yorkshire_bot.tgz --exclude=venv --exclude=__pycache__ --exclude=.pytest_cache --exclude=brain_memory_backup* yorkshire_bot
scp C:\Users\James\Desktop\moorstead.tgz yorkshire_bot.tgz james@evo-x2:~/
```

On the EVO X2:

```bash
mkdir -p ~/moorstead && cd ~/moorstead
tar -xzf ~/moorstead.tgz && tar -xzf ~/yorkshire_bot.tgz
```

> Keeping your existing villager memories? Also copy `yorkshire_bot/brain_memory`
> and drop it into `/var/lib/moorstead/brain_memory` after setup.

## 2. One-shot setup

```bash
cd ~/moorstead
sudo bash Moorcraft/deploy/setup-evo-x2.sh
```

Installs Ollama (tuned: `OLLAMA_NUM_PARALLEL=4`, 24h keep-alive, flash attention),
Caddy, Node 20; builds the game; creates the `moorstead` service user; installs
and starts the `moorstead-brain` systemd service. After it finishes the game is
live on the LAN at `http://<evo-ip>:8080`.

## 3. Pick the best brain for the hardware

128 GB of unified memory is a different league from the laptop's 8 GB 4060 —
benchmark on the box and let the script choose the largest model that still
feels chatty:

```bash
/opt/moorstead/venv/bin/python Moorcraft/deploy/bench_models.py --apply
sudo systemctl restart moorstead-brain
```

It measures time-to-first-token and tok/s per candidate (`llama3.2:3b` up to
`llama3.3:70b`), then picks the biggest model whose typical villager reply lands
inside ~7 s. Edit the candidate list or `--budget` to taste. Expect the sweet
spot on Strix Halo to be the ~27–32B class: a huge step up in villager wit while
replies stay conversational. The 70B will run, but every reply becomes a slow
nod by the fire — fine for solo play, not for visitors.

## 4. Expose it to the web

**Instant (random URL, zero config):**

```bash
sudo apt install -y cloudflared   # or grab the .deb from Cloudflare
cloudflared tunnel --url http://localhost:8080
```

You get an `https://something.trycloudflare.com` URL to share. It lives as long
as the process does.

**Permanent (your own domain, runs as a service):**

```bash
cloudflared tunnel login                 # one-time browser auth
cloudflared tunnel create moorstead
cloudflared tunnel route dns moorstead moorstead.yourdomain.com
sudo cloudflared --config /dev/null service install   # then set config:
sudo tee /etc/cloudflared/config.yml <<EOF
tunnel: moorstead
credentials-file: /home/james/.cloudflared/<TUNNEL_ID>.json
ingress:
  - hostname: moorstead.yourdomain.com
    service: http://localhost:8080
  - service: http_status:404
EOF
sudo systemctl enable --now cloudflared
```

No ports opened on the router; Cloudflare terminates TLS and DDoS-fronts it.
If you want it friends-only, put **Cloudflare Access** (free up to 50 users) in
front of the hostname — email one-time-PIN login, nothing else changes.

## How many can play at once?

- **Walking, building, mining**: effectively unlimited for your purposes —
  the game is static files + client-side compute; Cloudflare caches the assets.
  Dozens to hundreds of concurrent players is no strain on the X2.
- **Talking to villagers** is the bottleneck (one Ollama box). With
  `OLLAMA_NUM_PARALLEL=4` and a ~27B model: **3–5 people chatting at the same
  instant** get replies in roughly 5–15 s; beyond that, requests queue politely.
  With a 9B-class model that rises to **~10 simultaneous chatters**. Since chat
  is bursty, that comfortably supports a village of 15–25 active players.
- Knobs: smaller `BRAIN_MODEL` = more concurrent chatters; raise
  `OLLAMA_NUM_PARALLEL` to 6–8 if you see queueing with memory to spare.

## Operations

```bash
systemctl status moorstead-brain caddy ollama cloudflared
journalctl -u moorstead-brain -f        # watch villager conversations
sudo systemctl restart moorstead-brain  # after changing /etc/moorstead/brain.env
```

Redeploy after game changes: re-copy `Moorcraft/`, then
`npm ci && npm run build` and `sudo rsync -a --delete dist/ /opt/moorstead/game/`
(or just re-run the setup script — it's idempotent).
