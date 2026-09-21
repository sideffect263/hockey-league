#!/usr/bin/env bash
# Deploy the PUBLIC domain rinkhockeyil.com.
#
# WHY THIS EXISTS: `git push` to main auto-deploys ONLY hockey-league-pro.vercel.app.
# The public domain rinkhockeyil.com is a SEPARATE, self-owned Vercel project that
# does NOT auto-deploy. Standing rule (Ariel): ALWAYS run this after pushing web
# changes to main, so the public site never lags behind the -pro preview.
#
# It deploys the PUBLISH REMOTE's main (the committed, pushed state) from a CLEAN
# worktree — NOT the working tree — so parallel sessions' uncommitted WIP never leaks
# to the public site. Requires: `vercel` CLI logged into the rinkhockeyil team, and
# the repo's .vercel/ link present (it points the CLI at the rinkhockeyil project).
#
# WHICH REMOTE: `fork` (sideffect263/hockey-league), which now holds both `dev` and
# the `main` that rinkhockeyil.com serves. It used to be `origin`
# (IdanLichter/hockey-league); that remote still exists and still feeds
# hockey-league-pro.vercel.app, but it is no longer what the league sees. Resolved
# by name below and asserted, because deploying the WRONG repo's main to the public
# site would look entirely successful.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WT="$(mktemp -d)/rinkdeploy"

# Overridable, so a clone whose remotes are named differently is a one-word fix
# rather than an edit to this script.
PUBLISH_REMOTE="${PUBLISH_REMOTE:-fork}"

if ! git -C "$REPO" remote get-url "$PUBLISH_REMOTE" >/dev/null 2>&1; then
  echo "✗ no git remote named '$PUBLISH_REMOTE' — refusing to deploy." >&2
  echo "  rinkhockeyil.com serves sideffect263/hockey-league@main. Add that remote," >&2
  echo "  or re-run with PUBLISH_REMOTE=<name>." >&2
  exit 1
fi

echo "→ fetching $PUBLISH_REMOTE/main… ($(git -C "$REPO" remote get-url "$PUBLISH_REMOTE"))"
git -C "$REPO" fetch "$PUBLISH_REMOTE" --quiet

echo "→ creating clean worktree at $PUBLISH_REMOTE/main…"
git -C "$REPO" worktree add --detach "$WT" "$PUBLISH_REMOTE/main" >/dev/null
cp -R "$REPO/.vercel" "$WT/.vercel"
echo "  deploying: $(git -C "$WT" log -1 --oneline)"

echo "→ vercel --prod (remote build)…"
( cd "$WT" && vercel --prod --yes )

echo "→ cleaning up worktree…"
git -C "$REPO" worktree remove "$WT" --force
git -C "$REPO" worktree prune
echo "✓ rinkhockeyil.com is now serving $PUBLISH_REMOTE/main"

# ---------------------------------------------------------------------------
# Announce the Android build to the app.
#
# The Android app is sideloaded, so nothing tells a user a newer APK exists. Since
# 1.4.2 the app shows an in-app banner when its own versionCode is behind
# `league_settings.android_latest_version` — which means publishing an APK and
# forgetting to bump that row ships a release NOBODY IS EVER TOLD ABOUT, silently
# and with no error anywhere. So the deploy does it, and reads the number out of the
# APK actually being served rather than trusting a hand-edited constant.
#
# Non-fatal by design: the website is already live at this point, and a failure here
# must not read as a failed deploy. It shouts instead.
# ---------------------------------------------------------------------------
announce_apk() {
  local apk="$REPO/public/rinkhockeyIL.apk"
  [ -f "$apk" ] || { echo "⚠ no APK at public/rinkhockeyIL.apk — skipping version announce"; return; }

  if ! command -v apkanalyzer >/dev/null 2>&1; then
    echo "⚠ apkanalyzer not found — could not announce the APK version."
    echo "  Set it by hand, or users are never told this release exists:"
    echo "    update league_settings set value='<versionCode>' where key='android_latest_version';"
    return
  fi

  local code name
  code="$(apkanalyzer manifest version-code "$apk" 2>/dev/null | tail -1 | tr -d '[:space:]')"
  name="$(apkanalyzer manifest version-name "$apk" 2>/dev/null | tail -1 | tr -d '[:space:]')"
  case "$code" in
    ''|*[!0-9]*) echo "⚠ could not read a versionCode from the APK — skipping announce"; return ;;
  esac

  # The Management API runs SQL as the project owner, so it is not blocked by the
  # admin-only UPDATE policy on league_settings the way an anon key would be.
  set -a; . "$REPO/.env"; set +a
  if [ -z "${SUPABASE_ACCESS_TOKEN:-}" ] || [ -z "${SUPABASE_PROJECT_REF:-}" ]; then
    echo "⚠ SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_REF missing from .env — skipping announce"
    return
  fi

  local sql http
  sql="insert into public.league_settings (key, value) values
        ('android_latest_version','${code}'), ('android_latest_name','${name}')
       on conflict (key) do update set value = excluded.value, updated_at = now();"
  http="$(curl -s -o /tmp/rink-announce.out -w '%{http_code}' -X POST \
    "https://api.supabase.com/v1/projects/${SUPABASE_PROJECT_REF}/database/query" \
    -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
    -H "Content-Type: application/json" \
    --data "$(python3 -c 'import json,sys; print(json.dumps({"query": sys.argv[1]}))' "$sql")" || echo 000)"

  if [ "$http" = "200" ] || [ "$http" = "201" ]; then
    echo "✓ app update banner now points at Android ${name} (${code})"
  else
    echo "⚠ announce failed (HTTP ${http}) — users will NOT be told about this release."
    echo "  $(head -c 200 /tmp/rink-announce.out 2>/dev/null)"
    echo "  Fix by hand: update league_settings set value='${code}' where key='android_latest_version';"
  fi
  rm -f /tmp/rink-announce.out
}

announce_apk
