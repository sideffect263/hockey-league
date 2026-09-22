#!/usr/bin/env node
// ============================================================================
// podium-sync (local runner) — mirror our athletes' registration + payment state
// from podiumcomp.com into public.podium_athletes / public.podium_payments.
//
// WHY THIS RUNS ON A LAPTOP AND NOT ON THE SERVER
// The identical logic is deployed as the `podium-sync` Edge Function, and it
// works — except Podium sits behind Cloudflare, which serves a managed challenge
// ("Just a moment...", HTTP 403) to datacenter IPs. Deno Deploy is a datacenter
// IP; this Mac is not, and gets served normally. We are NOT going to defeat that
// challenge, so until Podium allowlists us or issues API access, the sync runs
// from here, by hand.
//
// The Edge Function stays deployed and correct. The day Podium grants access,
// schedule supabase/podium-sync-cron.sql and delete this file.
//
//   node scripts/podium-sync.mjs
//
// Needs, in the environment or in a gitignored .env.podium beside this repo:
//   PODIUM_USER, PODIUM_PASS      — the federation login
//   SUPABASE_SERVICE_ROLE_KEY     — writes bypass RLS; these tables are admin-only
// Optional: PODIUM_DISTRICT (defaults to rink hockey), PODIUM_SEASON_ID.
// ============================================================================
import { readFileSync, existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

// --- config ----------------------------------------------------------------
const ENV_FILE = ".env.podium";
if (existsSync(ENV_FILE)) {
  for (const line of readFileSync(ENV_FILE, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
  }
}

const SB_URL = process.env.VITE_SUPABASE_URL || "https://slpwwoupbbxcgjivcspv.supabase.co";
const SB_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PODIUM_USER = process.env.PODIUM_USER;
const PODIUM_PASS = process.env.PODIUM_PASS;
const BASE = "https://podiumcomp.com";
const DISTRICT = process.env.PODIUM_DISTRICT || "ענף הוקי גלגיליות - Rink Hockey";
const SEASON_ID = process.env.PODIUM_SEASON_ID || "";

const missing = [
  ["PODIUM_USER", PODIUM_USER], ["PODIUM_PASS", PODIUM_PASS],
  ["SUPABASE_SERVICE_ROLE_KEY", SB_SERVICE_ROLE],
].filter(([, v]) => !v).map(([k]) => k);
if (missing.length) {
  console.error(`Missing: ${missing.join(", ")}\nPut them in ${ENV_FILE} (gitignored) or export them.`);
  process.exit(1);
}

const admin = createClient(SB_URL, SB_SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// --- podium ----------------------------------------------------------------
const encodeParam = (o) => Buffer.from(encodeURIComponent(JSON.stringify(o))).toString("base64");

// Node's fetch sends no browser headers at all. These are not a disguise — this
// really is a browser on this machine — they just keep the request looking like
// what their own SPA sends.
const HEADERS = {
  "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  origin: BASE,
  referer: `${BASE}/login`,
  "accept-language": "he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7",
};

async function login() {
  const res = await fetch(`${BASE}/api/login`, {
    method: "POST",
    headers: { ...HEADERS, "content-type": "application/json" },
    body: JSON.stringify({ username: PODIUM_USER, password: PODIUM_PASS }),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 200);
    if (/just a moment/i.test(detail)) {
      throw new Error(
        "Cloudflare served a challenge to THIS machine too. Open podiumcomp.com in a " +
        "browser here first, or you are on a VPN / hotspot with a flagged IP.");
    }
    throw new Error(`login failed: ${res.status}${detail ? ` — ${detail}` : ""}`);
  }
  const body = await res.json();
  const cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  if (!cookie) throw new Error("login returned no session cookie");
  const org = body?.user?.username;
  if (!org) throw new Error("login returned no user.username");
  return { cookie, org, customer: PODIUM_USER.toLowerCase() };
}

async function api(s, path, params = {}) {
  const qs = new URLSearchParams({ username: s.org, customer_username: s.customer, ...params });
  const res = await fetch(`${BASE}/api/${path}?${qs}`, {
    headers: { ...HEADERS, cookie: s.cookie, accept: "application/json" },
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 200);
    throw new Error(`${path} failed: ${res.status}${detail ? ` — ${detail}` : ""}`);
  }
  return res.json();
}

async function fetchAthletes(s) {
  const filter = { staticDistrict: [DISTRICT] };
  if (SEASON_ID) filter.staticSeason = [SEASON_ID];
  const q = encodeParam(filter);
  const sort = encodeParam({ field: "name", direction: "asc" });
  const out = [];
  let page = 1, pages = 1;
  do {
    const j = await api(s, "athletes", { q, sort, page: String(page) });
    out.push(...(j.items ?? []));
    pages = j.totalPages ?? 1;
    page++;
  } while (page <= pages && page <= 50);
  return out;
}

const asDate = (v) => {
  if (!v || typeof v !== "string") return null;
  const d = new Date(v);
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
};
const asTs = (v) => {
  if (!v || typeof v !== "string") return null;
  const d = new Date(v);
  return isNaN(d) ? null : d.toISOString();
};
const hasFile = (v) => !!(v && typeof v === "object" && v.url);

// --- run -------------------------------------------------------------------
const started = new Date().toISOString();
const { data: run } = await admin
  .from("podium_sync_runs").insert({ started_at: started }).select("id").single();
const runId = run?.id ?? null;

try {
  const s = await login();
  console.log(`✓ logged in as ${s.customer} @ ${s.org}`);

  const athletes = await fetchAthletes(s);
  console.log(`✓ ${athletes.length} athletes in ${DISTRICT}`);

  const athleteRows = athletes.map((a) => ({
    podium_id: String(a._id),
    static_id: String(a.staticId ?? ""),
    season_id: a.staticSeason ? String(a.staticSeason) : null,
    district: a.staticDistrict ?? null,
    first_name: a.staticFirstName ?? null,
    last_name: a.staticLastName ?? null,
    full_name: (a.name ?? `${a.staticFirstName ?? ""} ${a.staticLastName ?? ""}`).trim(),
    birth_date: asDate(a.staticBirthDate),
    sex: a.staticSex ?? null,
    email: a.staticMail ?? null,
    phone: a.staticPhone ?? null,
    address: a.staticAddress ?? null,
    club: a.chosen_club ?? null,
    coach: a.chosen_coach || null,
    status: a.staticStatus ?? null,
    registered_at: asTs(a.registrationDate),
    medical_exam_date: asDate(a.staticMedicalApproveCreated),
    medical_expires_at: asDate(a.lastApprovedDate),
    has_medical_file: hasFile(a.staticMedicalApprove),
    has_id_document: hasFile(a["צילום תז או ספח הורה עם שם הילד/ה"]),
    synced_at: new Date().toISOString(),
  })).filter((r) => r.static_id);

  if (athleteRows.length) {
    const { error } = await admin.from("podium_athletes")
      .upsert(athleteRows, { onConflict: "podium_id" });
    if (error) throw error;
  }

  let paymentCount = 0;
  for (const r of athleteRows) {
    let rows = [];
    try {
      const j = await api(s, "get_athlete_payments", { athleteStaticId: r.static_id });
      rows = Array.isArray(j) ? j : (j?.items ?? []);
    } catch (e) {
      console.warn(`  ! payments for ${r.full_name}: ${e.message}`);
      continue; // one athlete must not lose the whole run
    }
    const payRows = rows.map((p) => ({
      podium_id: String(p._id),
      static_id: r.static_id,
      athlete_name: p.athlete_name ?? r.full_name,
      event_name: p.event_name ?? null,
      amount: typeof p.price === "number" ? p.price : null,
      paid_at: asTs(p.payment_time),
      payment_no: typeof p.payment_number === "number" ? p.payment_number : null,
      failed: p.failed === true,
      standing_order: p.isHoratKeva === true,
      payment_type: p.payment_type ?? null,
      synced_at: new Date().toISOString(),
    })).filter((p) => p.podium_id && p.podium_id !== "undefined");
    if (payRows.length) {
      const { error } = await admin.from("podium_payments")
        .upsert(payRows, { onConflict: "podium_id" });
      if (error) throw error;
      paymentCount += payRows.length;
    }
  }
  console.log(`✓ ${paymentCount} payment rows`);

  const { data: matched } = await admin.rpc("podium_match_athletes");
  console.log(`✓ matched ${matched ?? 0} athletes to player cards`);

  await admin.from("podium_sync_runs").update({
    finished_at: new Date().toISOString(), ok: true,
    athletes: athleteRows.length, payments: paymentCount,
    matched: typeof matched === "number" ? matched : null,
  }).eq("id", runId);

  const { data: unmatched } = await admin.rpc("podium_unmatched_athletes");
  if (unmatched?.length) {
    console.log(`\n⚠ ${unmatched.length} Podium athletes have no player card here:`);
    for (const u of unmatched) console.log(`   ${u.full_name} — ${u.club ?? "?"}`);
  }
  console.log("\nDone.");
} catch (e) {
  await admin.from("podium_sync_runs").update({
    finished_at: new Date().toISOString(), ok: false, error: e.message,
  }).eq("id", runId);
  console.error(`\n✗ ${e.message}`);
  process.exit(1);
}
