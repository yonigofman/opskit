---
name: verify-opskit
description: Full verification for OpsKit changes - build, typecheck, tests, Go checks, and a screenshot of the playground in both themes. Run before saying any OpsKit work is done, before committing, and when the user asks to check or verify.
---

# Verify OpsKit

Run everything from the repo root. Stop at the first failure, fix it, and run again from that step.

```bash
pnpm install --frozen-lockfile   # if this fails, the lockfile is out of date: run pnpm install and include the lockfile
pnpm build
pnpm typecheck
pnpm test
(cd gateway && test -z "$(gofmt -l .)" && go vet ./... && go test ./...)
node scripts/screenshot.mjs
```

`scripts/screenshot.mjs` serves `apps/playground/dist` and writes the screenshots to `.screenshots/` (git-ignored):

- `dark.png` and `light.png`, full page;
- console errors, printed (anything printed there is a failure).

## Look at the screenshots

Open both PNGs with the Read tool and check:

- The agent answer rendered fully (heading, all charts, the closing text) and nothing is cut off.
- Every component shows the state its gallery label says: Live, Loading, Empty, Error (query underlined), Forbidden (lock, "Ran as …"), Stale (badge, dimmed data, "reconnecting").
- Axis labels are not clipped (for example "0.4 cores", not "4 cores").
- No dashed threshold line at 0 unless a threshold of 0 was asked for.
- Provenance footers stay inside their panels in both themes.
- Text is readable in light theme (no light-on-light).

If a component you changed is not in the playground yet, add it there first (see `add-opskit-component`, step 6).

## Report

Say which checks ran and what the screenshots show, briefly. If something could not run, say so plainly rather than calling the work done.
