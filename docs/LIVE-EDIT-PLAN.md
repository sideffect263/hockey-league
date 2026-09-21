# עריכה חיה — live UI fixes from inside the webapp

> **HISTORICAL. This is the plan as written on 2026-09-14, and it was built —
> `src/components/liveedit/`, `api/live-edit.js`, `api/live-edit-promote.js`, both
> workflows. Kept for the reasoning, not as a description of the system.**
>
> Two things below are now WRONG, and both are in §0:
>
> 1. **`main` moved.** rinkhockeyil.com is published from **`sideffect263/hockey-league@main`**,
>    not `IdanLichter/hockey-league@main` (2026-09-21). The two-repo split — and the separate
>    `UPSTREAM_TOKEN` that made a leaked fork token unable to publish — is GONE. See
>    `docs/launch/03-remaining-and-future.md` for what replaced it and what that costs.
> 2. **"-pro keeps behaving exactly as it does today"** no longer holds. Nothing feeds
>    hockey-league-pro.vercel.app any more; it drifts.
>
> What §0 gets RIGHT and is still the whole point: the league's public site is never
> published as a side effect of code landing on a branch. Somebody presses the button.

Plan, not code. Drop this into a fresh session and build from it.

An admin standing on a page describes a UI bug in Hebrew. A Claude Code cloud
session edits the frontend, pushes, and the dev site redeploys — **no PR, no
approval**. The league's public site is never touched automatically.

---

## 0. Environments (VERIFIED 2026-09-14, the access is not what we assumed)

`hockey-league-pro.vercel.app` is **not in our Vercel account**. The `rinkhockeyil`
team holds exactly one project — `hockey-league` → rinkhockeyil.com — and it is
CLI-deployed, not git-connected. We cannot repoint `-pro`, so it cannot be the
agent's target.

We also have **push but not admin** on `IdanLichter/hockey-league` (public repo,
account `sideffect263`). So: no installing the Vercel GitHub App, and no branch
rulesets. Every deploy we control is CLI/token-driven — which is exactly how the
public site already deploys, so this is a known-good pattern, not a workaround.

| Branch | Environment | Deployed by |
|---|---|---|
| `dev` (**created**, at c0f54b9) | a NEW Vercel project, ours | the agent, via Vercel CLI/token |
| `main` | rinkhockeyil.com | humans: merge `dev` → `main`, then `scripts/deploy-public.sh` |
| `main` | hockey-league-pro (Idan's) | still auto-deploys, unchanged, not our concern |

Nothing about the league's public site changes. `-pro` keeps behaving exactly as it
does today.

**Still to do:** create the dev project under the `rinkhockeyil` team (CLI:
`vercel link --project hockey-league-dev --yes` in a `dev` worktree, then
`vercel --prod`). Give the routine a Vercel token scoped to that project.

## 0b. Promote to production (the button)

Because the public site already deploys from a clean `origin/main` worktree, the
promote path is three steps we can drive from the panel:

1. `git merge --ff-only dev` into `main` and push (or a fast-forward via the GitHub
   API, no local clone)
2. run `scripts/deploy-public.sh`, which deploys `origin/main` to rinkhockeyil.com
3. log it, and show the league-facing URL in the panel

This is the ONE step that stays deliberate — a separate button, a confirm, and
ideally a diff summary of what's about to go public ("3 changes since the last
promote"). Auto-push is for `dev`; the league is never a side effect.

## 1. The trigger

The claude.ai account supports routines (saved cloud sessions) with three fire
modes. We have zero today. Two candidates:

**A — direct run.** A Vercel function calls `POST /v1/code/triggers/{id}/run`
with the bug report in the body. One hop, no GitHub.
Cost: it authenticates with a personal claude.ai OAuth token, which then lives in
a Vercel env var and can start cloud sessions as Ariel.

**B — GitHub event (recommended).** The Vercel function opens a GitHub issue with
the report (fine-grained, repo-scoped, revocable token). A webhook trigger
(`POST /v1/code/webhook-triggers`, filtered to `issues.opened` with a label) fires
the routine. The issue doubles as the log and as where the agent reports back.

B costs one more moving part and buys a credential you can revoke without
touching your Claude account. Reversible either way — start with B.

**Verify first (unknown):** what fields `run`'s optional body accepts, and whether
a webhook-fired routine can read the issue body as its prompt. Confirm this before
designing the payload — everything downstream depends on it.

## 2. The panel

Lives behind `is_admin()`, mounted app-wide (a floating button, like the existing
chat bubble). Captures automatically, so the prompt is never just "this is broken":

- route + params, viewport, theme (light/dark), RTL
- last N console errors and failed requests
- **the Hebrew string nearest the tap** — this is the locator. UI copy in this repo
  is unique, so `grep "לא נמצאה אפשרות"` lands the agent on the exact file in one
  step. Cheaper and more reliable than source maps or component stacks.
- optionally the element's outerHTML snippet

## 3. The fence — enforced, not requested

Instructions in the routine prompt are not a control. Layer real ones:

1. **Path fence at the deploy step, not the push.** We have no repo admin, so a
   GitHub ruleset is off the table. Instead the thing WE own — the deploy — refuses:
   the routine (and the promote function) diff against the previous commit and abort
   on any change to `supabase/`, `api/`, `src/lib/api.js`, `src/lib/supabase.js`,
   `vercel.json`, `.github/`, `*.env*`. A bad commit can reach `dev`; it cannot reach
   a deployed site, and `git revert` cleans it up.
2. **The security model is in Postgres, not React.** RLS decides who reads medical
   files and birth dates; a frontend edit cannot grant itself access, and the cloud
   sandbox holds no service key. This is what makes auto-push defensible at all.
3. **Build must pass before push.** The routine runs `npm run build` in the sandbox
   and pushes only if green. Single cheapest gate we have.
4. **One run at a time** per repo — a lock row in Supabase, or the second request
   queues. Two agents pushing the same branch is the obvious first outage.

## 4. Undo

With no approval step, rollback IS the safety net and must be one tap:

- every run logs prompt + commit SHA + deploy URL to a Supabase table
- the panel shows the last N changes with an "בטל" button → `git revert <sha>` on
  `dev` (a second routine, or a Vercel function using the GitHub API) → redeploy
- Vercel's instant rollback stays the break-glass option

## 5. Feedback loop

Panel states: queued → running → pushed (sha) → deployed. Wire a Vercel deployment
webhook into a Supabase table and push it to the panel over Realtime — the same
mechanism the live-game banner and presence already use.

## 6. Open decisions

1. Trigger A or B (recommendation: B).
2. Does the panel ask for confirmation before the agent pushes, or is it fully
   fire-and-forget? "No approval" was the ask — worth being explicit that it means
   no *human diff review*, not no *build gate*.
3. Who gets it: `is_admin()` only, or league managers too?

## 7. Not in v1

No DB or RLS changes. No dependency installs. No public deploy. No mobile apps.
No multi-file refactors or "redesign this page" scope — one focused change per run.
No judgement about whether the change is *right*: a human still looks at the dev
site.

## 7b. Smoke test — what actually happened (2026-09-14)

Routine `trig_013xTekFezaigym87QxbAT7z` ("hockey live-edit agent (dev)"), fired via
`run`. Session `cse_01LLnr5PQsfxeEj6vvctYosD`, 82 seconds, 20 turns.

**Worked:**

- Fired on demand from a remote API call. Sandbox allocated, repo cloned,
  `dev` checked out. Read access is fine.
- **The Hebrew-string locator works, and self-corrects.** The string we sent
  (`דירוג קבוצות עונת 2026-27`) does not exist in source — it is a template,
  `דירוג קבוצות{seasonName && ` עונת ${seasonName}`}`. The agent fell back to the
  stable prefix, found `src/pages/Home.jsx:62`, and confirmed via `App.jsx` that
  `/standings` renders `Home`. So the panel should send the *rendered* text and let
  the agent reconcile — do not try to send a source string.
- Fence honoured. Build gate honoured: `npm ci` + `npm run build` both passed
  before it would commit.

**Landmine found — the build rewrites a tracked file.** `npm run build` is
`node scripts/gen-sitemap.mjs && vite build`, and `gen-sitemap.mjs` fetches live
data. In the sandbox it produced a gutted `public/sitemap.xml` (**-148 lines**) as
a side effect of the build gate. The agent noticed and reverted it before
committing, but that was judgement, not a rule. Any automated build-then-commit
flow WILL commit a broken sitemap eventually. Fix one of three ways: stage only the
files the agent intended, or `git checkout public/sitemap.xml` after every build,
or stop tracking the generated sitemap.

**BLOCKED at push — this is the real finding:**

```
remote: Claude doesn't have GitHub access to IdanLichter/hockey-league for your
organization. An org admin can install the Claude GitHub App…
fatal: … The requested URL returned error: 403
```

The cloud session can clone but not push. It needs the Claude GitHub App installed
on the repo, which needs repo admin — the same wall as the Vercel GitHub App.
Commit `c9e74fa` built clean and died with the sandbox.

### Three ways out

1. **Ask Idan** to install the Claude GitHub App on `IdanLichter/hockey-league`.
   One message, cleanest result, but it is someone else's decision and it grants
   the app across the repo.
2. **Fork to `sideffect263/hockey-league`**, where Ariel IS admin. Install the app
   there, point the dev Vercel project at the fork's `dev`, and let the agent live
   entirely in our own repo. Promotion becomes a push from the fork to the upstream
   `main` — which Ariel already has rights to do. No dependency on anyone.
3. **A token in the routine's `environment_variables`** (the field exists in the
   routine config, currently `{}`). A fine-grained GitHub PAT scoped to that one
   repo with contents:write needs no app install and no admin — Ariel already has
   push rights, and the token simply carries them. The same mechanism solves the
   OTHER open blocker: a `VERCEL_TOKEN` there lets the run deploy the dev project
   itself (`npx vercel --prod --token=$VERCEL_TOKEN`) instead of waiting for a
   human to deploy from a laptop.

**Recommendation: 3 for speed (it unblocks push AND deploy in one move, and depends
on nobody), 2 if we want the agent permanently sandboxed away from the shared repo.**
Ariel creates the tokens — do not have a session mint or paste them for him.

## 7c. Loop PROVEN end to end (2026-09-14, run 2)

Option 2 chosen. `sideffect263/hockey-league` forked (admin: true, carried `main`
and `dev`), the Claude GitHub App installed on the fork only, routine repointed at
it. Session `cse_01T29qpq9PC8ViWNogSx7UY8`, ~80 seconds:

remote API call → cloud session → located `src/pages/Home.jsx:62` by Hebrew string →
one-line edit → `npm ci` + `npm run build` green → commit `0275715` → **pushed to
`fork/dev`** → deployed → **live on https://hockey-league-dev.vercel.app/standings**
reading `דירוג קבוצות עונת 2026-27 · סביבת בדיקות`.

The diff was exactly what was asked: 1 file, 1 line, and the sitemap rule held (no
`public/sitemap.xml` damage this time — it is in the prompt now, not left to
judgement). `origin/main` untouched; the league's site never entered the path.

**TRAP HIT, worth its own line:** the repo's checked-in `.vercel/project.json`
points at the **PUBLIC** project (`hockey-league` → rinkhockeyil.com). Copying it
into a deploy worktree — which is what `scripts/deploy-public.sh` deliberately
does — would have published the agent's commit to the league. Any dev deploy must
`rm -rf .vercel && vercel link --project hockey-league-dev --yes` first. This is the
single most dangerous step in the whole design; automate it with the link baked in,
never by copying the repo's.

### The one gap left

The agent still cannot deploy — a human ran the deploy above. Closing it needs a
`VERCEL_TOKEN` (scoped to the dev project) in the routine's `environment_variables`,
after which the run ends with `npx vercel --prod --token=$VERCEL_TOKEN`. Ariel
creates that token; no session should mint or paste it.

After that, the remaining work is the panel and the trigger — the risky unknowns are
all now answered.

## 8. Build order

1. ~~`dev` branch~~ **DONE** — created at c0f54b9, identical to `main`.
2. Create the `hockey-league-dev` Vercel project under the `rinkhockeyil` team and
   deploy `dev` to it once, by hand. Confirm the URL serves the app.
3. Create the routine by hand. Fire it with `run`. Confirm it can commit to `dev`,
   pass the build gate, and deploy. **This is the risky unknown — prove it before
   any UI exists.**
4. Path fence + build gate inside the routine.
5. The trigger path (A or B) behind a Vercel function.
6. The panel, read-only at first: capture the context, show the payload, don't send.
7. Turn on sending. Log every run. Then add undo.
8. Last: the promote-to-production button (0b), with its confirm and its diff
   summary.
