// ============================================================================
// podium-sync — mirror our athletes' registration + payment state from
// podiumcomp.com (the Israeli roller-sports federation's system) into
// public.podium_athletes / public.podium_payments.
//
// Why: players register and pay in Podium and separately in this app. Before
// this, the league manager cross-checked a Podium tab by hand before approving
// anyone's medical certificate (stage 2 of the medical flow). Now the queue row
// already says whether he is registered and whether he paid.
//
// Called by pg_cron (job `podium-sync`, every 6h) and by the סנכרן עכשיו button
// in /admin. Auth is the service-role key in the Authorization header, so
// verify_jwt stays ON.
//
// Podium is a Vue SPA over a plain JSON API — no scraping, no browser. Auth is
// POST /api/login {username,password} returning an httpOnly session cookie, and
// every subsequent call carries ?username=<org>&customer_username=<login>.
// Deno's fetch has no cookie jar, so the login's Set-Cookie is captured and
// replayed by hand.
//
// NOT mirrored, on purpose:
//   • document URLs — Podium serves medical files from unauthenticated,
//     non-expiring Firebase links, and our own medical bucket is private with
//     120s signed URLs. We keep their exposure theirs.
//   • card_holder_name / last_four_digits / deal numbers — "did he pay, when,
//     how much" needs none of it.
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!; // auto-injected
const PODIUM_USER = Deno.env.get("PODIUM_USER") ?? "";
const PODIUM_PASS = Deno.env.get("PODIUM_PASS") ?? "";

const BASE = "https://podiumcomp.com";
// The federation runs ten sports in one system; we only want ours.
const DISTRICT = Deno.env.get("PODIUM_DISTRICT") ?? "ענף הוקי גלגיליות - Rink Hockey";
// Optional pin. Left empty, the sync takes whatever season Podium reports for the
// athletes it returns, so a season rollover needs no redeploy.
const SEASON_ID = Deno.env.get("PODIUM_SEASON_ID") ?? "";

const admin = createClient(SB_URL, SB_SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** Podium encodes its query params as base64 of the URL-encoded JSON. */
const encodeParam = (obj: unknown) => btoa(encodeURIComponent(JSON.stringify(obj)));

// Podium sits behind Cloudflare. A bare Deno fetch carries no User-Agent, no
// Origin and no Referer, which is exactly the shape of a request a bot rule turns
// away with a 403 (a wrong password gets a plain 401 from Express instead). These
// are the headers their own SPA sends.
const BROWSERISH: Record<string, string> = {
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  "origin": BASE,
  "referer": `${BASE}/login`,
  "accept-language": "he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7",
};

type Session = { cookie: string; org: string; customer: string };

async function login(): Promise<Session> {
  if (!PODIUM_USER || !PODIUM_PASS) {
    throw new Error("PODIUM_USER / PODIUM_PASS are not set");
  }
  const res = await fetch(`${BASE}/api/login`, {
    method: "POST",
    headers: { ...BROWSERISH, "content-type": "application/json" },
    body: JSON.stringify({ username: PODIUM_USER, password: PODIUM_PASS }),
  });
  if (!res.ok) {
    // The body is the difference between "wrong password" (401, Express, plain
    // text) and Cloudflare turning away a datacenter IP (403, an HTML challenge).
    // Without it a 403 is unactionable. Truncated, and it never echoes the
    // credentials back.
    const detail = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 200);
    throw new Error(`podium login failed: ${res.status}${detail ? ` — ${detail}` : ""}`);
  }
  const body = await res.json();
  // Deno exposes multiple Set-Cookie headers via getSetCookie(); keep only the
  // name=value pair of each, which is all the server wants back.
  const jar = (res.headers as Headers & { getSetCookie?: () => string[] })
    .getSetCookie?.() ?? [];
  const cookie = jar.map((c) => c.split(";")[0]).join("; ");
  if (!cookie) throw new Error("podium login returned no session cookie");
  // The org slug comes from the response, the customer slug is the login name
  // lowercased — exactly what the SPA stores in localStorage.
  const org = body?.user?.username;
  if (!org) throw new Error("podium login returned no user.username");
  return { cookie, org, customer: PODIUM_USER.toLowerCase() };
}

async function api(s: Session, path: string, params: Record<string, string> = {}) {
  const qs = new URLSearchParams({
    username: s.org,
    customer_username: s.customer,
    ...params,
  });
  const res = await fetch(`${BASE}/api/${path}?${qs}`, {
    headers: { ...BROWSERISH, cookie: s.cookie, accept: "application/json" },
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 200);
    throw new Error(`podium ${path} failed: ${res.status}${detail ? ` — ${detail}` : ""}`);
  }
  return res.json();
}

/** Every athlete in our district, following Podium's pagination. */
async function fetchAthletes(s: Session) {
  const filter: Record<string, string[]> = { staticDistrict: [DISTRICT] };
  if (SEASON_ID) filter.staticSeason = [SEASON_ID];
  const q = encodeParam(filter);
  const sort = encodeParam({ field: "name", direction: "asc" });

  const out: Record<string, unknown>[] = [];
  let page = 1, pages = 1;
  do {
    const j = await api(s, "athletes", { q, sort, page: String(page) });
    out.push(...(j.items ?? []));
    pages = j.totalPages ?? 1;
    page++;
  } while (page <= pages && page <= 50); // hard stop; the league is ~100 athletes
  return out;
}

const asDate = (v: unknown) => {
  if (!v || typeof v !== "string") return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};
const asTs = (v: unknown) => {
  if (!v || typeof v !== "string") return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
};
// A file field is {url, fileName} — we record only WHETHER it exists.
const hasFile = (v: unknown) =>
  !!(v && typeof v === "object" && (v as { url?: string }).url);

/**
 * verify_jwt only proves the caller is signed in, and any signed-in account must not
 * be able to hammer Podium. pg_cron calls with the service-role key; the admin
 * "סנכרן עכשיו" button calls with the user's own JWT, which has to be admin or
 * league manager.
 */
async function assertCaller(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (token && token === SB_SERVICE_ROLE) return; // pg_cron
  const { data: { user } } = await admin.auth.getUser(token);
  if (!user) throw new Error("not authorized");
  const [{ data: isAdmin }, { data: roles }] = await Promise.all([
    admin.from("admin_users").select("email").eq("email", user.email ?? "").maybeSingle(),
    admin.from("user_roles").select("role").eq("user_id", user.id).eq("role", "league_manager").maybeSingle(),
  ]);
  if (!isAdmin && !roles) throw new Error("not authorized");
}

Deno.serve(async (req) => {
  const started = new Date().toISOString();
  let runId: number | null = null;
  try {
    await assertCaller(req);
    const { data: run } = await admin
      .from("podium_sync_runs").insert({ started_at: started }).select("id").single();
    runId = run?.id ?? null;

    const s = await login();
    const athletes = await fetchAthletes(s);

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
      // onConflict podium_id: player_id / matched_by are ours and must survive a
      // re-sync, so they are simply not in the payload.
      const { error } = await admin.from("podium_athletes")
        .upsert(athleteRows, { onConflict: "podium_id" });
      if (error) throw error;
    }

    // Payments are per athlete. ~100 athletes with a couple of rows each — small
    // enough to walk serially and stay polite to their server.
    let paymentCount = 0;
    for (const r of athleteRows) {
      let rows: Record<string, unknown>[] = [];
      try {
        const j = await api(s, "get_athlete_payments", { athleteStaticId: r.static_id });
        rows = Array.isArray(j) ? j : (j?.items ?? []);
      } catch (_) {
        continue; // one athlete's payments failing must not lose the whole run
      }
      const payRows = rows.map((p) => ({
        podium_id: String(p._id),
        static_id: r.static_id,
        athlete_name: (p.athlete_name as string) ?? r.full_name,
        event_name: (p.event_name as string) ?? null,
        amount: typeof p.price === "number" ? p.price : null,
        paid_at: asTs(p.payment_time),
        payment_no: typeof p.payment_number === "number" ? p.payment_number : null,
        failed: p.failed === true,
        standing_order: p.isHoratKeva === true,
        payment_type: (p.payment_type as string) ?? null,
        synced_at: new Date().toISOString(),
      })).filter((p) => p.podium_id && p.podium_id !== "undefined");
      if (payRows.length) {
        const { error } = await admin.from("podium_payments")
          .upsert(payRows, { onConflict: "podium_id" });
        if (error) throw error;
        paymentCount += payRows.length;
      }
    }

    const { data: matched } = await admin.rpc("podium_match_athletes");

    await admin.from("podium_sync_runs").update({
      finished_at: new Date().toISOString(), ok: true,
      athletes: athleteRows.length, payments: paymentCount,
      matched: typeof matched === "number" ? matched : null,
    }).eq("id", runId!);

    return new Response(JSON.stringify({
      ok: true, athletes: athleteRows.length, payments: paymentCount, matched,
    }), { headers: { "content-type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (runId) {
      await admin.from("podium_sync_runs").update({
        finished_at: new Date().toISOString(), ok: false, error: msg,
      }).eq("id", runId);
    }
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500, headers: { "content-type": "application/json" },
    });
  }
});
