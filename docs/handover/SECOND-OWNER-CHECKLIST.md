# Second owner + vault — step by step

_Written 2026-10-21. About 2 hours, in one sitting with the trusted person next to you (or on a call)._

Tick each box as you go. When done, update the "Owner today" column in
[ACCESS-INVENTORY.md](ACCESS-INVENTORY.md).

## 0. Pick the person

Someone who (a) will still be around the league in 2 years, (b) can be trusted with the
players' medical data, (c) is comfortable enough to open Claude Code and follow RUNBOOK.md. They
don't need to be a developer. Ideally not someone who might leave together with you.

## 1. The shared vault (Bitwarden, free)

**Why Bitwarden:** a free *Organization* holds 2 users and a shared collection, which is exactly
this. (1Password Families works too, ~$5/mo.)

- [ ] You: create a Bitwarden account → **New organization** → Free plan → name it `rinkhockeyIL`.
- [ ] Invite the second person to the organization as **Owner**. Make a collection `league`.
- [ ] Add these items to the `league` collection (each as a Login or Secure Note):

| Item | What to store |
|---|---|
| Google `arielxx263@gmail.com` | password + recovery codes (Google → Security → 2-Step → Backup codes) |
| Google `arielbiton03@gmail.com` | same |
| Apple ID (developer account) | password + recovery key / trusted phone info |
| Cloudflare, Vercel, Supabase, GitHub `sideffect263`, Play Console, Resend, Podium | login, or "uses Google X" + its 2FA backup codes |
| **Android keystore** | Secure Note: store password, key password, alias `rinkhockeyil`, SHA-1 `C9:C9:AA:25…`, **and the file itself as base64** (below) |
| Apple distribution cert `dist.p12` | base64 + its password |
| Keys `AuthKey_23CGB7K85Q.p8` (ASC API), `AuthKey_J984K4BSP7.p8` (Sign in with Apple web), APNs `BWX82829T9` | paste the `.p8` text (it's plain text) |

Free Bitwarden has no file attachments, so store the binary files as text. On the Mac:
```bash
base64 -i ~/Documents/ariel/hockey/rinkhockeyIL-signing/rinkhockeyil-release.jks | pbcopy
```
then paste into the Secure Note. To restore it later: `pbpaste | base64 -d > rinkhockeyil-release.jks`
and check the SHA-1 with `keytool -list -v -keystore rinkhockeyil-release.jks`.

## 2. The offline USB copy

- [ ] Plug in a USB stick, open **Disk Utility** → select it → **Erase** → Format **APFS (Encrypted)**,
  name `RINK-KEYS`, choose a password (put that password in the vault too).
- [ ] Copy the keys folder and verify the copy:
```bash
cp -R ~/Documents/ariel/hockey/rinkhockeyIL-signing /Volumes/RINK-KEYS/ && shasum -a 256 ~/Documents/ariel/hockey/rinkhockeyIL-signing/rinkhockeyil-release.jks /Volumes/RINK-KEYS/rinkhockeyIL-signing/rinkhockeyil-release.jks
```
  The two hashes must match.
- [ ] Eject. Keep it somewhere that isn't your laptop bag (a drawer at home or with the second person).

## 3. Add the second owner, service by service

| ✓ | Service | Where | Role to give |
|---|---|---|---|
| [ ] | **Cloudflare** (DNS, **domain registrar**, Stream) | dash.cloudflare.com → Manage Account → **Members** → Invite | **Super Administrator** |
| [ ] | Cloudflare billing | Manage Account → Billing | Check the domain's **auto-renew is ON** (expires 2027-07-10) and the card is valid |
| [ ] | **Supabase** | supabase.com/dashboard → org "sideffect263's Org" → **Team** → Invite | **Owner** |
| [ ] | Supabase billing | Org → Billing | Card valid; consider adding the league's card |
| [ ] | **Google Play Console** | play.google.com/console → **Users and permissions** → Invite new users | **Admin (all permissions)** |
| [ ] | **App Store Connect** | appstoreconnect.apple.com → **Users and Access** → + | **Admin** (can upload, submit and release; only you can renew the $99 fee) |
| [ ] | **GitHub** | see "GitHub needs an organization" below | Org **Owner** |
| [ ] | **Vercel** | see "Vercel" below | — |
| [ ] | Google Cloud `rinkhockeyil` + Firebase `rinkhockeyil-c1694` | console.cloud.google.com → IAM → Grant access | **Owner** (Firebase inherits it) |
| [ ] | GA4 + Search Console (optional) | Admin → Access management / Settings → Users | Administrator / Owner |

**GitHub needs an organization.** Repos in a personal account can't have a second admin. Steps:
github.com → + → **New organization** (Free) → e.g. `rinkhockeyil` → invite the person as
**Owner** → then in each repo (`hockey-league`, `rinkhockeyil-ios`, `rinkhockeyil-android`):
Settings → **Transfer ownership** → the new org. GitHub redirects the old URLs, and Actions
secrets move with the repo. **After transferring, tell Claude** so it can update the git
remotes, `scripts/deploy-public.sh`'s expectations and the docs.

**Vercel:** the Hobby (free) plan doesn't allow team members; adding one needs Pro ($20/mo).
The free option is to put the Vercel login in the vault. Deploys run from GitHub Actions with a
token, so whoever has GitHub can deploy anyway.

## 4. The "if I'm unreachable" switch on your Google accounts

- [ ] For **both** Gmails: myaccount.google.com/inactive → **Inactive Account Manager** → after 3
  months of inactivity, notify the second person and share Gmail + Drive. This covers the case
  where nobody has the password.
- [ ] Apple ID: Settings → your name → Sign-In & Security → **Legacy Contact** (covers data, not
  the developer account).

## 5. Later (not urgent)

- [ ] Move the Apple Developer account to an **Organization** enrollment for the association
  (needs a D-U-N-S number), then transfer the app. This is the only way to stop one person being
  the Account Holder.
- [ ] Have the second person do one real thing alone (deploy the site from Actions, or record a
  result) using RUNBOOK.md. Whatever they get stuck on goes back into the runbook.
