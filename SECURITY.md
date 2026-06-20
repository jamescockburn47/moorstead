# Security

Moorstead is a browser game with a self-hosted multiplayer backend. If you find a vulnerability or need to report in-game abuse, contact the maintainer via GitHub issues (security-sensitive reports: mark the issue **private** if GitHub allows, or email the repo owner directly).

## What must never be committed

- **Invite codes** (`word-word-NN` format) — they are live credentials.
- **`moorstead keys.md`**, `handout.txt`, `codes.json`, `accounts.json`, `ws_tokens.json` from the EVO.
- API keys, tunnel tokens, Tailscale keys, or WhatsApp session material.

The parish ledger mints session tokens at login; old tokens are invalidated when codes rotate.

## Public repo vs live secrets

This repository is **public**. It contains client code, server reference implementations under `deploy/`, and documentation. **Live invite codes and player accounts exist only on the home server**, not in git.

If a code appears in git history, **rotate it on the server** (remove from `codes.json`, mint a replacement, update `wardens.json` for warden codes, redeploy the client `ADMIN_HASHES` if the warden invite changed).

## Reporting abuse in-game

Griefing, harassment, or attempts to enter the children's (`bairns`) room without a valid invite are logged server-side. Offenders are banned by player id and display name. See the **Security & privacy** tab on [/about.html](https://www.moorstead.app/about.html?tab=security).

## Infrastructure

- Game client: Vercel CDN (`www.moorstead.app`)
- Multiplayer / brain / login: self-hosted behind Cloudflare Tunnel (hostname in client config only)
- Admin dashboard: not exposed to the public internet

Do not publish Tailscale IPs, raw LAN addresses, or personal paths in documentation commits.
