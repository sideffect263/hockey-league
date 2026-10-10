// ============================================================================
// ingest-rink-hockey-news — pull rink-hockey items from vetted external feeds
// (SOURCES below) and post them to the league feed as rows in public.posts.
//
// Called by pg_cron (job `rink-hockey-news`, daily), NOT by end users. Auth is
// the service-role key in the Authorization header, so verify_jwt stays ON.
//
// Why these three sources (scouted 2026-09-15, see docs/rink-hockey-sources.md):
//   • WSE Rink Hockey TV + OKLIGA.TV — the only sources that carry a thumbnail
//     in the feed itself, and video is what people actually open.
//   • World Skate Europe — the governing body's own written news.
// Every other candidate was rejected: the Spanish federation publishes no dates
// at all, FISR mixes in artistic skating, Mundo Deportivo is a commercial outlet.
//
// Volume control matters more here than throughput. These feeds are BURSTY — WSE
// Europe published 10 items in 9 days during the Euros and nothing for weeks
// after — so a run is capped per source and per run, and anything older than
// MAX_AGE_DAYS is dropped. That also makes the very first run safe: it posts a
// handful of recent items instead of dumping a 35-item backlog into the feed.
// ============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!; // auto-injected

const admin = createClient(SB_URL, SB_SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ---- Tuning ---------------------------------------------------------------
const MAX_AGE_DAYS = 14;        // older than this is not news
const MAX_NEW_PER_SOURCE = 3;   // a tournament burst trickles in over days
const MAX_NEW_PER_RUN = 8;      // ...and never floods a single day's feed
// Videos get their own budget. They hold attention about twice as long as articles
// (ניתוח פיד, 2026-10-08: 16s vs 8s median), and with one shared budget the written
// sources listed first used it up before any video source was reached.
const MAX_VIDEOS_PER_RUN = 6;
// Daily caps for WRITTEN articles (2026-10-08). Per-run caps alone let ~25 articles a
// day through three runs, and two Italian/Chilean sites made up half the feed. "A day"
// = items in the feed dated within the last 24h (created_at is the source's publish
// time), so a backlog can't sneak past by arriving late.
const MAX_ARTICLES_PER_DAY = 8;
const MAX_ARTICLES_PER_SOURCE_PER_DAY = 2;

const BOT_EMAIL = "news-bot@rinkhockeyil.com";
const BOT_NAME = "חדשות הוקי גלגיליות";

type Source = {
  key: string;
  kind: "youtube" | "rss";
  name: string;      // shown on the card as the source chip
  url: string;
  // RSS only: drop an item carrying any of these <category> tags. Some rink-hockey
  // outlets also cover the other roller sports under the same feed.
  excludeCategories?: string[];
  // Keep only items whose title matches. For channels that mix highlights with
  // interviews or full 2-hour games (Skate Italia).
  includeTitle?: RegExp;
  // Overrides MAX_NEW_PER_SOURCE for a high-volume channel.
  maxPerRun?: number;
  // Match-highlight clips: headline built by highlightHeadline(), not translated whole.
  highlights?: boolean;
};

const SOURCES: Source[] = [
  {
    key: "wse-tv",
    kind: "youtube",
    name: "WSE Rink Hockey TV",
    url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCjUBgw3RIYYbivfVcXP83Yg",
  },
  {
    key: "okliga-tv",
    kind: "youtube",
    name: "OKLIGA.TV",
    url: "https://www.youtube.com/feeds/videos.xml?channel_id=UC6RLLzXQJWy1yCAEysy1Wgw",
  },
  // ---- Removed 2026-10-10 (≈ zero opens over 30 days, see ניתוח פיד): World Skate
  // Europe news, Andi Colaianni, Patines y Chuecas, HoqueiPatins.pt, Federação de
  // Patinagem de Portugal, swiss skate, Actus Rink. Their old posts were soft-deleted.
  // ---- Added 2026-09-28: the Italian and Argentine leagues, in pre-season then.
  {
    // Italian hockey su pista (Serie A1/A2, Coppa Italia) — several items a day
    // in season. The category feed is pista only; the site's inline is separate.
    key: "hockeyitalia21",
    kind: "rss",
    name: "Hockey Italia 21",
    url: "https://hockeyitalia21.com/category/hockey-su-pista/feed/",
  },
  {
    // Italian national sports outlet, hockey-pista category — ~weekly.
    key: "oasport",
    kind: "rss",
    name: "OA Sport",
    url: "https://www.oasport.it/category/hockey-pista/feed/",
  },
  {
    // Argentina's national rink-hockey committee (CNTHsP) — sporadic, no images.
    key: "cnthsp",
    kind: "rss",
    name: "Comité Nacional Hockey sobre Patín (AR)",
    url: "https://comitehockeypatin.ar/feed/",
  },
  {
    // Highest-volume written source (Barça-heavy); quiet in summer, busy Oct–Jun.
    // media:content carries the image.
    key: "mundodeportivo",
    kind: "rss",
    name: "Mundo Deportivo",
    url: "https://www.mundodeportivo.com/rss/hockey-patines",
  },
  // ---- Added 2026-10-08: highlights + tactics video. Ariel wants more game
  // highlights and analysis; every feed below was checked (200 + embeddable).
  {
    // Highlights re-uploads: World Championship, OK Liga, Portugal, Italy, Champions
    // League, Argentina. Posts ~5 a day, so it is capped. Fan channel re-uploading
    // broadcasts — a video can be taken down later and leave a dead embed.
    key: "somdhoquei",
    kind: "youtube",
    name: "Som D'hoquei",
    url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCpzv8BikWPwHoQugAWE8Ikg",
    includeTitle: /highlights/i,
    highlights: true,
    maxPerRun: 2,
  },
  {
    // Italian federation. Serie A1 highlights (~7 per matchday) mixed with
    // interviews and full games — the title filter keeps the highlights only.
    key: "skate-italia",
    kind: "youtube",
    name: "Skate Italia Hockey Pista",
    url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCFcx30ZnLm7eDDLCrFxX3JA",
    includeTitle: /^\s*highlights/i,
    highlights: true,
  },
  {
    // Tactics and referee analysis (Spanish), 4–7 min. Follows the season.
    key: "azul-directa",
    kind: "youtube",
    name: "Azul Directa",
    url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCjQeZ1gzxoHwqtpaSxohPbw",
  },
];

// ---- Minimal feed parsing --------------------------------------------------
// These are small, well-formed RSS/Atom documents; Deno has no built-in XML
// parser and pulling one in for four fields is not worth the dependency.

function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")   // last: otherwise "&amp;#39;" decodes in two passes
    .trim();
}

function tag(xml: string, name: string): string | null {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decodeEntities(m[1]) : null;
}

function attr(xml: string, tagName: string, attrName: string): string | null {
  const m = xml.match(new RegExp(`<${tagName}[^>]*\\s${attrName}="([^"]+)"`, "i"));
  return m ? decodeEntities(m[1]) : null;
}

// First <img src> inside the item's HTML body (content:encoded or description).
function firstImage(xml: string): string | null {
  const m = xml.match(/<img[^>]+src="([^"]+)"/i);
  return m ? decodeEntities(m[1]) : null;
}

function parseCategories(xml: string): string[] {
  return [...xml.matchAll(/<category>([\s\S]*?)<\/category>/gi)].map((m) => decodeEntities(m[1]));
}

type Item = {
  guid: string; title: string; link: string; published: Date; image: string | null; categories: string[];
  summary: string | null;  // source-language lead, cleaned (cleanSummary) — translated at post time
};

// ---- Summaries --------------------------------------------------------------
// A headline alone told people too little (Ariel, 2026-10-08), so each item gets a
// one-to-three-sentence lead from the feed's own description — no extra request.
// It goes in the FIRST paragraph, on the line under the headline, because every
// client (web card, iOS displayBody, Android displayBody) shows only the first
// paragraph of a news post: the summary reaches the released apps with no release.
const SUMMARY_MAX = 280;
const STRIP_TAIL = /\s*(\[(…|\.\.\.)\]|…|\.\.\.)?\s*(leer m[aá]s|ler mais|leggi( tutto| anche)?|continua a leggere|read more|lire la suite)\b[\s\S]*$/i;
function normalize(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
function cleanSummary(raw: string | null, title: string): string | null {
  if (!raw) return null;
  let s = decodeEntities(decodeEntities(raw))
    .replace(/<[^>]+>/g, " ")
    // WordPress's "The post X appeared first on Y" footer, in the sources' languages.
    .replace(/\s(The post|L['’]articolo|La entrada|O post|Le post|L['’]entrada) [\s\S]*? (appeared first on|proviene da|aparece primero en|apareceu primeiro em|est apparu en premier sur|apareix primer a) [\s\S]*$/i, "")
    .replace(/\s+/g, " ").trim()
    .replace(STRIP_TAIL, "")
    .replace(/\s*\[?\s*(…|\.\.\.)\s*\]?\s*$/, "…")
    .trim();
  // A feed excerpt cut off mid-sentence: drop the half sentence when there is a
  // whole one before it ("…alla COP Arena di […" → ends at the previous full stop).
  if (s.endsWith("…")) {
    const lastStop = Math.max(s.lastIndexOf(". "), s.lastIndexOf("! "), s.lastIndexOf("? "));
    if (lastStop > 40) s = s.slice(0, lastStop + 1);
  }
  // Several outlets open the description with the headline itself.
  const t = normalize(title);
  if (t && normalize(s).startsWith(t)) {
    const words = title.trim().split(/\s+/).length;
    s = s.split(/\s+/).slice(words).join(" ").replace(/^[\s:.,–-]+/, "");
  }
  if (s.length < 40 || normalize(s) === t) return null;
  // Whole sentences up to the cap; a single over-long sentence is cut at a word.
  const sentences = s.match(/[^.!?…]+[.!?…]+["'”»)]?\s*|[^.!?…]+$/g) ?? [s];
  let out = "";
  for (const sen of sentences) {
    if ((out + sen).trim().length > SUMMARY_MAX) break;
    out += sen;
  }
  out = out.trim();
  if (!out) out = s.slice(0, SUMMARY_MAX).replace(/\s+\S*$/, "") + "…";
  return out.length >= 40 ? out : null;
}

// YouTube descriptions are mostly credits, hashtags and "subscribe" links. Keep the
// first block of real prose (Azul Directa writes some); otherwise no summary.
function youTubeSummary(raw: string | null, title: string): string | null {
  if (!raw) return null;
  const para = decodeEntities(raw).split(/\n\s*\n/)[0]
    .split("\n")
    .filter((l) => !/https?:|#|@|subscri|suscr|follow|s[ií]guenos|📌|📆|🎥|📷|📍|🏆/i.test(l))
    .join(" ");
  return cleanSummary(para, title);
}

function parseFeed(xml: string, src: Source): Item[] {
  // Each block MUST be cut at its own closing tag. Splitting alone leaves every
  // block running to the end of the document, so an entry missing a field (a
  // video with no thumbnail, say) would silently inherit the NEXT entry's.
  const name = src.kind === "youtube" ? "entry" : "item";
  const blocks = xml.split(`<${name}`).slice(1)
    .map((b) => b.split(`</${name}>`)[0]);

  const out: Item[] = [];
  for (const b of blocks) {
    const title = tag(b, "title");
    if (!title) continue;
    if (src.includeTitle && !src.includeTitle.test(title)) continue;

    let guid: string | null, link: string | null, dateStr: string | null, image: string | null;
    if (src.kind === "youtube") {
      const videoId = tag(b, "yt:videoId");
      guid = videoId ? `yt:${videoId}` : null;
      link = videoId ? `https://www.youtube.com/watch?v=${videoId}` : attr(b, "link", "href");
      dateStr = tag(b, "published");
      image = attr(b, "media:thumbnail", "url");
    } else {
      link = tag(b, "link");
      guid = tag(b, "guid") || link;
      dateStr = tag(b, "pubDate");
      // Neither WSE Europe nor Patines y Chuecas ships an enclosure, but both
      // embed the article's lead image in the HTML body — so pull the first <img>
      // rather than scraping og:image with an extra request per item.
      image = attr(b, "media:content", "url") || attr(b, "enclosure", "url") || firstImage(b);
    }
    if (!guid || !link || !dateStr) continue;

    const published = new Date(dateStr);
    if (Number.isNaN(published.getTime())) continue;

    const categories = src.kind === "rss" ? parseCategories(b) : [];
    if (src.excludeCategories?.some((c) => categories.includes(c))) continue;

    // Highlight clips: the matchup in the headline is the whole story, and their
    // descriptions are credits and links.
    const summary = src.highlights ? null
      : src.kind === "youtube" ? youTubeSummary(tag(b, "media:description"), title)
      : cleanSummary(tag(b, "description") || tag(b, "content:encoded"), title);

    out.push({ guid: `${src.key}:${guid}`, title, link, published, image, categories, summary });
  }
  return out.sort((a, b) => b.published.getTime() - a.published.getTime());
}

// ---- Hebrew ---------------------------------------------------------------
// Headlines arrive in English (WSE) and Spanish (OK Liga, Patines y Chuecas).
// Untranslated they sit badly next to the rest of an all-Hebrew feed — but a
// failed translation must degrade, not fail: the item still posts, under its
// original title.
//
// Google Translate's keyless endpoint used by its Chrome dictionary extension.
// Free, no account — chosen after Gemini's prepaid credits ran out on 2026-09-22
// and every call came back 402 while the run reported success.
//
// NOT the better-known translate.googleapis.com `client=gtx` endpoint: that one
// works from a laptop but answers the edge runtime's shared cloud egress with a
// 429 "Sorry..." bot page on every call (verified 2026-09-26). This one answers
// the same egress with 200. Both are unofficial, so Google can throttle or change
// either without notice — any surprise returns null and the source title is used.
// Google renders "hockey pista / patines / em patins" as track, rink-floor or roller
// hockey. The league's name for the sport is הוקי גלגיליות — use it everywhere.
const SPORT_MISNAMES = /הוקי (על )?(מסלול|משטח|רולר|גלגלים|החלקה|סקייטים|פטינים|בפטינים|על גלגיליות)/g;
function fixSportName(he: string): string {
  return he.replace(SPORT_MISNAMES, "הוקי גלגיליות");
}

async function translateToHebrew(title: string): Promise<string | null> {
  try {
    const url = "https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=auto&tl=iw&q=" +
      encodeURIComponent(title);
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`google translate HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    // With sl=auto the answer is [["<hebrew>", "<detected lang>"]]; with a fixed
    // source language it is ["<hebrew>"]. Take the text from either shape.
    const first = Array.isArray(data) ? data[0] : null;
    const text = (Array.isArray(first) ? first[0] : first);
    return typeof text === "string" && text.trim() ? fixSportName(text.trim()) : null;
  } catch (err) {
    console.error("translate failed, falling back to source title:", err);
    return null;
  }
}

// Machine translation wrecks match-highlight titles: "Highlights" came back as
// "הבהרה" / "דגשים", and team names get "translated" (Lloret → "יורט"). So: a fixed
// Hebrew label, the matchup kept as written (vs → נגד), and only the competition
// segments translated. "Lloret vs Barça (1-6) | HIGHLIGHTS LLIGA CATALANA" →
// "תקציר · Lloret נגד Barça (1-6) · <ליגה קטלאנית>".
const MATCHUP = /\s(vs\.?|x)\s/i;
async function highlightHeadline(title: string): Promise<string> {
  const cleaned = title
    .replace(/\bhighlights?\b\s*[:|\-–]?/gi, " ")
    .replace(/\b(roll(er)?hockey|hockey su pista|rink hockey)\b\s*,?/gi, " ")
    .replace(/\s{2,}/g, " ").trim();
  const segments = cleaned.split(/\s[|–]\s|\s-\s(?=[^-]*\s(?:vs\.?|x)\s)|\s\|\s?/)
    .map((x) => x.replace(/^[\s|:\-–]+|[\s|:\-–]+$/g, "")).filter(Boolean);
  const out: string[] = [];
  for (const seg of segments) {
    if (MATCHUP.test(seg)) out.push(seg.replace(/\s(vs\.?|x)\s/i, " נגד "));
    else out.push((await translateToHebrew(seg)) ?? seg);
  }
  return ["תקציר", ...out].join(" · ");
}

// ---- Bot author ------------------------------------------------------------
// posts.author_id → profiles.id → auth.users.id, so external news needs a real
// account. Provisioned here rather than by hand so there is no service-role key
// to pass around and no undocumented manual step before the first run.
async function ensureBotAuthor(): Promise<string> {
  const { data: existing, error } = await admin
    .from("profiles").select("id").eq("is_bot", true).limit(1).maybeSingle();
  if (error) throw error;
  if (existing) return existing.id;

  const password = crypto.randomUUID() + crypto.randomUUID(); // never used to sign in
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: BOT_EMAIL, password, email_confirm: true,
    user_metadata: { display_name: BOT_NAME },
  });
  if (createErr || !created?.user) throw createErr ?? new Error("bot user not created");

  // The handle_new_user trigger inserts the profiles row; set the bot fields on it.
  const { error: upErr } = await admin.from("profiles")
    .upsert({ id: created.user.id, display_name: BOT_NAME, is_bot: true }, { onConflict: "id" });
  if (upErr) throw upErr;
  return created.user.id;
}

// ---- Ingest ----------------------------------------------------------------
/**
 * Fetch a feed, retrying transient failures.
 *
 * The first unattended cron run (2026-09-16 05:00Z) had ALL THREE YouTube feeds
 * come back 404 while both RSS feeds succeeded; minutes later every one of them
 * returned 200 from the same function. So YouTube intermittently refuses requests
 * from the edge runtime's egress. Without a retry that day's items simply never
 * arrive — and because the freshness window is finite, an item that is unlucky on
 * enough consecutive days ages out and is lost silently rather than late.
 */
async function fetchFeed(src: Source): Promise<string> {
  const delays = [0, 1500, 4000];
  let lastErr: unknown;
  for (const wait of delays) {
    if (wait) await new Promise((r) => setTimeout(r, wait));
    try {
      const res = await fetch(src.url, {
        headers: { "user-agent": "rinkhockeyil-feed-bot/1.0 (+https://rinkhockeyil.com)" },
        // A hung feed must not eat the whole run's budget.
        signal: AbortSignal.timeout(20_000),
      });
      if (res.ok) return await res.text();
      lastErr = new Error(`${src.key}: HTTP ${res.status}`);
      // 4xx other than 404/429 is a real, permanent problem — don't burn retries.
      if (res.status !== 404 && res.status !== 429 && res.status < 500) break;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error(`${src.key}: fetch failed`);
}

// The article page's og:image, or null. Only og:image — a page's first <img> is
// usually the site logo (CNTHsP's is), which is worse than no card at all.
async function fetchOgImage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "rinkhockeyil-feed-bot/1.0 (+https://rinkhockeyil.com)" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ??
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    return m ? decodeEntities(m[1]) : null;
  } catch {
    return null;
  }
}

/**
 * One-off: add a summary to posts already in the feed that were ingested before
 * summaries existed (their first paragraph is the headline alone). Rewrites only
 * the first paragraph — the headline and the trailing source/link lines are kept.
 */
async function backfillSummaries(src: Source, dryRun: boolean, maxAgeDays: number) {
  const items = parseFeed(await fetchFeed(src), src)
    .filter((i) => i.summary && i.published.getTime() >= Date.now() - maxAgeDays * 86_400_000);
  if (!items.length) return { source: src.key, updated: [] as string[], preview: [] as unknown[] };
  const { data: rows, error } = await admin
    .from("posts").select("id, body, external_guid")
    .in("external_guid", items.map((i) => i.guid)).is("deleted_at", null);
  if (error) throw error;
  const updated: string[] = [];
  const preview: unknown[] = [];
  for (const row of rows ?? []) {
    const [first, ...rest] = String(row.body).split("\n\n");
    if (first.includes("\n")) continue;              // already has a summary
    const item = items.find((i) => i.guid === row.external_guid)!;
    const summary = await translateToHebrew(item.summary!);
    if (!summary) continue;
    const body = [`${first}\n${summary}`, ...rest].join("\n\n").slice(0, 2000);
    if (dryRun) { preview.push({ guid: row.external_guid, body }); continue; }
    const { error: upErr } = await admin.from("posts").update({ body }).eq("id", row.id);
    if (upErr) { console.error(`${src.key}: summary update failed`, upErr); continue; }
    updated.push(row.external_guid);
  }
  return { source: src.key, updated, preview };
}

async function ingestSource(src: Source, authorId: string, budget: number, dryRun: boolean, maxAgeDays: number) {
  const items = parseFeed(await fetchFeed(src), src);
  const cutoff = Date.now() - maxAgeDays * 86_400_000;
  const fresh = items.filter((i) => i.published.getTime() >= cutoff);

  // One round-trip to find which of these we already have. Soft-deleted rows keep
  // their external_guid, so an item a moderator removed stays removed.
  const { data: seen, error: seenErr } = await admin
    .from("posts").select("external_guid").in("external_guid", fresh.map((i) => i.guid));
  if (seenErr) throw seenErr;
  const seenSet = new Set((seen ?? []).map((r) => r.external_guid));

  const unseen = fresh.filter((i) => !seenSet.has(i.guid));
  const cap = Math.min(src.maxPerRun ?? MAX_NEW_PER_SOURCE, budget);

  // A news card without media is not shown (product call, 2026-09-28). Items the
  // feed ships without an image get one try at the article's og:image; anything
  // still bare is skipped — and stays unseen, so it isn't counted against the cap.
  const todo: Item[] = [];
  const noMedia: string[] = [];
  for (const item of unseen) {
    if (todo.length >= cap) break;
    if (!item.image) item.image = await fetchOgImage(item.link);
    if (item.image) todo.push(item);
    else noMedia.push(item.guid);
  }

  const posted: string[] = [];
  const preview: unknown[] = [];
  for (const item of todo) {
    const headline = src.highlights
      ? await highlightHeadline(item.title)
      : (await translateToHebrew(item.title)) ?? item.title;
    // The link is in the body as well as link_url on purpose: the native apps
    // render body text only, so without it an item would be unopenable there.
    // Headline first. It used to open with a per-source lead sentence ("🎥 סרטון
    // חדש · …"), which made two videos from the same event look like the same post
    // twice — the source is already on the card as a chip. The trailing lines are
    // for the native apps, which render body text only and would otherwise have no
    // source and no way to open the item; the web card hides everything after the
    // first paragraph.
    // Summary only when it translated — a Spanish paragraph under a Hebrew headline
    // reads worse than none.
    const summary = item.summary ? await translateToHebrew(item.summary) : null;
    const lead = summary ? `${headline}\n${summary}` : headline;
    const body = `${lead}\n\n${src.name}\n${item.link}`;

    if (dryRun) {
      preview.push({ guid: item.guid, published: item.published.toISOString(), body, image: item.image });
      continue;
    }

    const { error } = await admin.from("posts").upsert({
      author_id: authorId,
      body: body.slice(0, 2000),           // posts.body CHECK: 1..2000
      source_name: src.name,
      link_url: item.link,
      image_url: item.image,
      external_guid: item.guid,
      created_at: item.published.toISOString(), // sort by when it was published, not ingested
    }, { onConflict: "external_guid", ignoreDuplicates: true });
    if (error) { console.error(`${src.key}: insert failed`, error); continue; }
    posted.push(item.guid);
  }
  return { source: src.key, fetched: items.length, fresh: fresh.length, posted, preview, no_media: noMedia };
}

Deno.serve(async (req) => {
  try {
    // verify_jwt is NOT enough on its own: the anon key is a valid JWT and it is
    // public by design, so anyone could trigger an ingest. The caller must present
    // the service-role key itself — which is what pg_cron sends from the vault.
    const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (bearer !== SB_SERVICE_ROLE) {
      return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
    }

    // { "dry_run": true } parses the feeds and reports what WOULD post, writing
    // nothing. The feed is public and reaches the native apps — verify first.
    // `max_age_days` widens the freshness window for a one-off backfill (these
    // feeds go quiet for weeks between tournaments, so the daily 14-day window
    // legitimately finds nothing most of the year). Cron never sends it.
    let dryRun = false;
    let maxAgeDays = MAX_AGE_DAYS;
    let only: string[] | null = null;
    let backfill = false;
    try {
      const body = await req.json();
      dryRun = !!body?.dry_run;
      if (Number.isFinite(body?.max_age_days)) maxAgeDays = Math.min(Number(body.max_age_days), 400);
      // `only: ["oasport"]` restricts the run to named sources. Cron never sends
      // it; it exists so one source can be seeded or debugged without the shared
      // per-run budget being spent by whichever source is listed first.
      if (Array.isArray(body?.only) && body.only.length) only = body.only.map(String);
      // `backfill_summaries: true` adds summaries to existing posts instead of ingesting.
      backfill = !!body?.backfill_summaries;
    } catch { /* no body → a normal cron run */ }

    if (backfill) {
      const report = [];
      for (const src of SOURCES) {
        if (only && !only.includes(src.key)) continue;
        try { report.push(await backfillSummaries(src, dryRun, maxAgeDays)); }
        catch (err) { report.push({ source: src.key, error: String(err) }); }
      }
      return Response.json({ ok: true, dry_run: dryRun, backfill: true, report });
    }

    const authorId = dryRun ? "dry-run" : await ensureBotAuthor();
    const report = [];
    // Articles already in the feed from the last 24h, per source.
    const { data: recent, error: recentErr } = await admin.from("posts")
      .select("source_name").not("external_guid", "is", null).is("deleted_at", null)
      .gte("created_at", new Date(Date.now() - 86_400_000).toISOString());
    if (recentErr) throw recentErr;
    const today = new Map<string, number>();
    for (const r of recent ?? []) today.set(r.source_name, (today.get(r.source_name) ?? 0) + 1);
    const rssToday = SOURCES.filter((x) => x.kind === "rss").reduce((n, x) => n + (today.get(x.name) ?? 0), 0);

    const budget = { youtube: MAX_VIDEOS_PER_RUN, rss: Math.max(0, Math.min(MAX_NEW_PER_RUN, MAX_ARTICLES_PER_DAY - rssToday)) };

    // Quietest article sources first, so the daily budget isn't always spent by
    // whichever busy site happens to be listed first. Videos keep list order.
    const ordered = [
      ...SOURCES.filter((x) => x.kind === "youtube"),
      ...SOURCES.filter((x) => x.kind === "rss").sort((a, b) => (today.get(a.name) ?? 0) - (today.get(b.name) ?? 0)),
    ];

    for (const src of ordered) {
      if (only && !only.includes(src.key)) continue;
      const left = src.kind === "rss"
        ? Math.min(budget.rss, MAX_ARTICLES_PER_SOURCE_PER_DAY - (today.get(src.name) ?? 0))
        : budget.youtube;
      if (left <= 0) { report.push({ source: src.key, skipped: budget[src.kind] <= 0 ? "budget spent" : "daily source cap" }); continue; }
      try {
        const r = await ingestSource(src, authorId, left, dryRun, maxAgeDays);
        budget[src.kind] -= (dryRun ? r.preview.length : r.posted.length);
        report.push(r);
      } catch (err) {
        // One dead feed must not stop the others.
        console.error(`${src.key} failed:`, err);
        report.push({ source: src.key, error: String(err) });
      }
    }
    return Response.json({ ok: true, dry_run: dryRun, report });
  } catch (err) {
    console.error("ingest failed:", err);
    return Response.json({ ok: false, error: String(err) }, { status: 500 });
  }
});
