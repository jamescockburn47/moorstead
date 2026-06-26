# Deploying Moorstead

The client is a Vite app on Vercel (project `moorcraft` → www.moorstead.app). The
village **brain** is a separate service on the EVO (`moorstead.sovren.xyz`) and is
**not** touched by a client deploy.

## Ship it

```bash
npm run deploy
```

That's the only command you need. It runs a gate, then deploys:

1. **Gate (warns; `--force` to override):** refuses to deploy if
   - the working tree is dirty (uncommitted changes wouldn't be in the build),
   - you're not on `main` (production ships from `main`), or
   - `main` isn't pushed to `origin`.
2. **`npm run verify`** — the full suite. Aborts on any failure.
3. **`npm run build`** — production build sanity check. Aborts on failure.
4. **Version bump + commit** — patch-bumps `package.json` `version`. This updates
   `version.json` in the build, which running clients fetch to show the "update
   available" toast / auto-reload (see `vite.config.js` + `src/update-check.js`).
   **A deploy without a bump leaves open tabs unaware a new version shipped.**
5. **`git push origin main`**, then **`vercel --prod`**.

### Flags

| Flag | Effect |
|------|--------|
| `npm run deploy -- --minor` | minor bump (1.1.0 → 1.2.0) |
| `npm run deploy -- --major` | major bump (1.1.0 → 2.0.0) |
| `npm run deploy -- --no-bump` | deploy without changing the version |
| `npm run deploy -- --force` | proceed despite gate warnings (use sparingly) |

## Force all clients to reload

A patch/minor/major bump shows a soft "update available" notice. To force every
open client to hard-reload (e.g. a breaking change), also raise
`minClientVersion` in `package.json` to the new version before deploying — it
drives the forced reload in `src/update-check.js`.

## Rollback

Production points to the most recent `vercel --prod`. To revert:

```bash
vercel ls moorcraft            # find a known-good previous deployment URL
vercel rollback <deployment-url>
```

(Or promote a previous deployment from the Vercel dashboard.) Then reconcile git
if needed.

## CI

`.github/workflows/verify.yml` runs `verify` + `build` on every push to `main`
and every PR — a server-side net that catches regressions even if a deploy slips
past the local gate.

## Conventions

- **Deploy from `main`.** Keep `main` current so it's a real baseline and
  rollback point. (`main` once drifted 87 commits behind — don't let it.)
- **Perf canaries.** `verify-flora-rebuild` and `verify-roadperf` guard the
  walk-stutter fix (sliced flora rebuild + grid-accelerated `roadInfo`). They run
  inside `npm run verify`. If you change the flora overlay or road lookups, keep
  them green.
