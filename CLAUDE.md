# hockey-league

The Israeli rink-hockey league site. Vite + React + Supabase, Hebrew/RTL throughout.
Live at **rinkhockeyil.com**.

## Git: push to `fork`, not `origin`

There are two remotes and they are NOT interchangeable.

| remote | repo | what it is |
|---|---|---|
| **`fork`** | `sideffect263/hockey-league` | **ours. Both branches. Everything goes here.** |
| `origin` | `IdanLichter/hockey-league` | the repo this was forked from. We have push but not admin. **Frozen — do not push.** |

`main` tracks `fork/main`. Plain `git push` is correct; `git push origin main` is not.

As of 2026-09-21 the league's site is published from **`fork/main`**. `origin/main` stopped
being the source of truth and now only feeds `hockey-league-pro.vercel.app`, a Vercel project
nobody here controls, which is drifting.

## Deploying

| branch | site | trigger |
|---|---|---|
| `dev` | hockey-league-dev.vercel.app | push, or Actions → "deploy dev" |
| `main` | **rinkhockeyil.com** | **`workflow_dispatch` only** — Actions → "deploy public", or `scripts/deploy-public.sh` |

**Landing code on `main` does not publish it.** Somebody presses a button. That is deliberate:
a branch push must never be able to reach the league's website. Don't add a `push:` trigger to
`deploy-public.yml`.

**Shipping an Android APK still goes through `scripts/deploy-public.sh`**, not the workflow. Only
the script reads the version out of the served APK and writes it to
`league_settings.android_latest_version` — the thing that tells sideloaded users an update exists.
Skip it and the release ships and nobody is ever told, with no error anywhere.

## The fence, and why it will refuse your push

`deploy-dev.yml` refuses to deploy `dev` if a push touched `supabase/`, `api/`, `.github/`,
`src/lib/api.js`, `src/lib/supabase.js`, `vercel.json` or `.env*`. New files under
`supabase/migrations/` are the one exemption, and only if additive (`scripts/check-migration.mjs`).

It exists because the live-edit agent pushes to `dev` with nobody reading the diff. A human
pressing "Run workflow" IS reading the diff, so on `workflow_dispatch` the checks still run and
print but warn instead of refusing.

Consequence that will bite you: **fast-forwarding `dev` up to `main` is refused**, because that
diff genuinely does touch those paths. Deploy it by hand from the Actions tab instead.

There is ONE Supabase project. `dev` and rinkhockeyil.com share it, so a migration hits real
league data the moment it runs — including minors' records. See `docs/LIVE-EDIT-MIGRATIONS.md`.

## עריכה חיה (live-edit) is dev-only

The in-app panel that edits the frontend and redeploys is gated to dev hosts in
`src/components/liveedit/LiveEditPanel.jsx` — an **allowlist** (`localhost`,
`hockey-league-dev*.vercel.app`), so a new domain or alias defaults to no panel. Both sites build
from the same commit, so this must stay a runtime hostname check; a build flag ships to both.

Its promote path (`api/live-edit-promote.js`) is now the main thing standing between an agent and
the league's website. It used to also be protected by a second credential the agent did not hold;
that boundary is gone. Treat its audit and the fence as load-bearing.

## Other sessions are working in this tree

Several Claude sessions share this checkout. **Never `git add -A` / `git add .`** — stage the
paths you touched, by name. Uncommitted files you did not create are somebody's work in progress,
possibly being written this minute. Leave them.

## Gotchas that have cost real time

- **`players` is the only table with column-level grants** (`birth_date` excluded). ANY `select('*')`
  on it — including a PostgREST embed `players(*)` — 403s the **whole request**. Name columns.
- **`npm run build` rewrites tracked `public/sitemap.xml`.** Don't commit that hunk by accident.
- **Don't split React into its own Vite `manualChunk`** — circular chunk dep, `forwardRef` crash.
  Route-level `lazy()` is fine.
- **Scores display as `away:home`.** Digits render LTR inside an RTL row, so the home team is on
  the right. Wrap LTR runs (dates, scores) in `dir="ltr"`.
- **The source tree is not evidence of what is live** — pushing does not deploy. To know what
  rinkhockeyil.com serves, curl it and grep the served chunks for a marker the commit *introduced*
  (a guard, not a UI string — strings usually predate the change to their behaviour).
