// Source recovered from the deployed function (v14) on 2026-10-08 — it had never been
// committed. Deploy with JWT verification ON (the default):
//   supabase functions deploy delete-account --project-ref slpwwoupbbxcgjivcspv
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}

// Deletes the calling user's account: best-effort cleanup of their rows, then the
// auth user itself. Requires a valid user JWT (verify_jwt=true). Used by the mobile
// apps' in-app "Delete account" (App Store guideline 5.1.1(v)).
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!jwt) return json({ error: "missing token" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

    const { data: { user }, error } = await admin.auth.getUser(jwt);
    if (error || !user) return json({ error: "unauthorized" }, 401);
    const uid = user.id;

    // Best-effort cleanup of user-owned rows (children first). Ignore per-table errors.
    for (const [table, col] of [
      ["feed_item_comments", "author_id"],
      ["feed_item_likes", "user_id"],
      ["post_likes", "user_id"],
      ["comments", "author_id"],
      ["posts", "author_id"],
      ["player_claims", "profile_id"],
      ["user_roles", "user_id"],
      ["profiles", "id"],
    ] as const) {
      try { await admin.from(table).delete().eq(col, uid); } catch (_e) { /* ignore */ }
    }

    const { error: delErr } = await admin.auth.admin.deleteUser(uid);
    if (delErr) return json({ error: delErr.message }, 500);
    return json({ ok: true }, 200);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
