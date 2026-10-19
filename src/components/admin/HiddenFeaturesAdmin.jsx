import { useEffect, useMemo, useState } from "react"
import { Star, BellRing, Megaphone, Send, Loader2, RefreshCw, AlertTriangle, X } from "lucide-react"
import {
  getHiddenSettings, setHiddenSetting, DEFAULTS, parseAnnouncement, suggestAnnouncementId,
  buildAnnouncement, countBroadcastRecipients, sendBroadcast, getRecentBroadcasts, broadcastError,
} from "@/lib/hiddenFeatures"
import { SkeletonPanelRows } from "@/components/skeletons/PageSkeletons"

/**
 * תכונות מוסתרות — switches the iOS / Android apps read from league_settings at launch
 * (docs/HIDDEN-FEATURES-SPEC.md), plus the admin broadcast push. Admin-only: the
 * league_settings writes and admin_broadcast_notification both check is_admin().
 * A missing key = OFF, so "כבה" writes 'off' (there is no delete policy).
 */
export default function HiddenFeaturesAdmin({ teams = [] }) {
  const [rows, setRows] = useState(null)
  const [loadErr, setLoadErr] = useState(null)

  const load = async () => {
    setLoadErr(null)
    try { setRows(await getHiddenSettings()) }
    catch (e) { setLoadErr(e.message || "שגיאה בטעינה"); setRows({}) }
  }
  useEffect(() => { load() }, [])

  if (rows === null) return <SkeletonPanelRows />

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">תכונות מוסתרות</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            מתגים שהאפליקציות קוראות בפתיחה. מפתח שלא קיים = כבוי. אפליקציה ישנה מתעלמת מהם.
          </p>
        </div>
        <button onClick={load} className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" title="רענון">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>
      {loadErr && <ErrorLine msg={loadErr} />}

      <FlagCard
        icon={Star} title="בקשת דירוג בחנות" flagKey="feature_review_prompt"
        numKey="review_prompt_min_opens" numLabel="מספר פתיחות לפני שמותר לבקש" numDefault={DEFAULTS.review_prompt_min_opens}
        hint="חלון הדירוג של App Store / Google Play, רק אחרי רגע טוב (ניצחון של קבוצה במעקב, שמירת שיפוט, לייק/תגובה שנייה)."
        rows={rows} onSaved={load}
      />
      <FlagCard
        icon={BellRing} title="כרטיס הפעלת התראות" flagKey="feature_push_nudge"
        numKey="push_nudge_interval_days" numLabel="ימים בין תזכורות לכל מכשיר" numDefault={DEFAULTS.push_nudge_interval_days}
        hint="כרטיס בראש הפיד למי שלא אישר התראות: ”לא לפספס אף משחק“."
        rows={rows} onSaved={load}
      />
      <AnnouncementEditor stored={rows.announcement?.value} onSaved={load} />
      <BroadcastPanel teams={teams} />
    </div>
  )
}

function ErrorLine({ msg }) {
  return (
    <p className="flex items-center gap-1.5 text-sm text-red-600 dark:text-red-400">
      <AlertTriangle className="w-4 h-4 shrink-0" /> {msg}
    </p>
  )
}

function Toggle({ on, disabled, onClick, label }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={onClick}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
        on ? "bg-brand" : "bg-slate-300 dark:bg-slate-600"}`}>
      <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
        on ? "-translate-x-[22px]" : "-translate-x-0.5"}`} />
    </button>
  )
}

function FlagCard({ icon: Icon, title, hint, flagKey, numKey, numLabel, numDefault, rows, onSaved }) {
  const on = rows[flagKey]?.value === "on"
  const storedNum = rows[numKey]?.value
  const [num, setNum] = useState(storedNum ?? String(numDefault))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  useEffect(() => { setNum(storedNum ?? String(numDefault)) }, [storedNum, numDefault])

  const run = async (fn) => {
    setBusy(true); setErr(null)
    try { await fn(); await onSaved() } catch (e) { setErr(e.message || String(e)) } finally { setBusy(false) }
  }
  const n = parseInt(num, 10)
  const numValid = Number.isInteger(n) && n >= 0 && n <= 365 && String(n) === num.trim()
  const numDirty = num.trim() !== (storedNum ?? String(numDefault))

  return (
    <section className="card p-4 sm:p-5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <Icon className="w-5 h-5 text-brand mt-0.5 shrink-0" />
          <div className="min-w-0">
            <h3 className="font-semibold text-slate-800 dark:text-slate-100">{title}</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{hint}</p>
            <p className="text-[11px] text-slate-400 mt-1 font-mono" dir="ltr">{flagKey} = {rows[flagKey]?.value ?? "(missing → off)"}</p>
          </div>
        </div>
        <Toggle on={on} disabled={busy} label={title}
          onClick={() => run(() => setHiddenSetting(flagKey, on ? "off" : "on"))} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm text-slate-600 dark:text-slate-300">{numLabel}</label>
        <input type="number" min={0} max={365} value={num} onChange={(e) => setNum(e.target.value)} dir="ltr"
          className="w-20 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-sm" />
        {numDirty && (
          <button disabled={!numValid || busy} onClick={() => run(() => setHiddenSetting(numKey, String(n)))}
            className="px-3 py-1 rounded-lg bg-brand text-white text-sm font-semibold disabled:opacity-50">שמירה</button>
        )}
        {!numValid && <span className="text-xs text-red-500">מספר שלם 0–365</span>}
      </div>
      {err && <ErrorLine msg={err} />}
    </section>
  )
}

const toLocalInput = (iso) => {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  const off = d.getTimezoneOffset() * 60000
  return new Date(d.getTime() - off).toISOString().slice(0, 16)
}

const AUDIENCE_LABEL = { all: "כולם", signed_in: "משתמשים מחוברים", signed_out: "לא מחוברים" }

function formFrom(stored) {
  const a = parseAnnouncement(stored)
  return {
    id: a?.id || "", title: a?.title || "", body: a?.body || "",
    button_label: a?.button_label || "", button_url: a?.button_url || "",
    audience: a?.audience || "all", starts_at: toLocalInput(a?.starts_at), ends_at: toLocalInput(a?.ends_at),
    active: a ? a.active !== false : true,
  }
}

function AnnouncementEditor({ stored, onSaved }) {
  const current = parseAnnouncement(stored)
  const live = !!current && current.active !== false
  const [f, setF] = useState(() => formFrom(stored))
  const [idTouched, setIdTouched] = useState(!!current?.id)
  const [slug, setSlug] = useState("")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [ok, setOk] = useState(null)
  useEffect(() => { setF(formFrom(stored)); setIdTouched(!!parseAnnouncement(stored)?.id) }, [stored])

  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }))
  const onSlug = (e) => {
    setSlug(e.target.value)
    if (!idTouched) setF((p) => ({ ...p, id: suggestAnnouncementId(e.target.value) }))
  }
  const built = useMemo(() => buildAnnouncement(f), [f])
  const sameIdAsLive = current?.id && current.id === f.id.trim()

  const publish = async () => {
    if (!built.ok) return
    setBusy(true); setErr(null); setOk(null)
    try {
      await setHiddenSetting("announcement", JSON.stringify(built.json))
      setOk(built.json.active ? "פורסם ✓ — יוצג פעם אחת לכל מכשיר" : "נשמר (לא פעיל)")
      await onSaved()
    } catch (e) { setErr(e.message || String(e)) } finally { setBusy(false) }
  }
  const turnOff = async () => {
    setBusy(true); setErr(null); setOk(null)
    try {
      const next = current ? { ...current, active: false } : null
      await setHiddenSetting("announcement", next ? JSON.stringify(next) : "")
      setOk("כובה ✓")
      await onSaved()
    } catch (e) { setErr(e.message || String(e)) } finally { setBusy(false) }
  }

  const input = "w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
  const lbl = "block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1"

  return (
    <section className="card p-4 sm:p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Megaphone className="w-5 h-5 text-brand mt-0.5 shrink-0" />
          <div>
            <h3 className="font-semibold text-slate-800 dark:text-slate-100">הודעה קופצת באפליקציה</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              מוצגת פעם אחת לכל מזהה בכל מכשיר. כדי להציג שוב — מזהה חדש.
            </p>
          </div>
        </div>
        <span className={`text-xs font-semibold px-2 py-1 rounded-full shrink-0 ${live
          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
          : "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"}`}>
          {live ? `פעילה: ${current.id}` : "אין הודעה פעילה"}
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={lbl}>שם קצר (לטינית, להצעת מזהה)</label>
              <input className={input} dir="ltr" value={slug} onChange={onSlug} placeholder="ff-tickets" />
            </div>
            <div>
              <label className={lbl}>מזהה</label>
              <input className={input} dir="ltr" value={f.id}
                onChange={(e) => { setIdTouched(true); set("id")(e) }} placeholder="ff-tickets-2026-10-11" />
            </div>
          </div>
          {sameIdAsLive && <p className="text-xs text-amber-600">אותו מזהה כמו ההודעה הקיימת — מי שכבר ראה אותה לא יראה שוב.</p>}
          <div>
            <label className={lbl}>כותרת</label>
            <input className={input} value={f.title} onChange={set("title")} maxLength={80} />
          </div>
          <div>
            <label className={lbl}>תוכן (שורות חדשות נשמרות)</label>
            <textarea className={`${input} min-h-[96px]`} value={f.body} onChange={set("body")} maxLength={1000} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={lbl}>טקסט כפתור (רשות)</label>
              <input className={input} value={f.button_label} onChange={set("button_label")} placeholder="לפרטים" />
            </div>
            <div>
              <label className={lbl}>קישור כפתור</label>
              <input className={input} dir="ltr" value={f.button_url} onChange={set("button_url")} placeholder="https://rinkhockeyil.com/games" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className={lbl}>קהל</label>
              <select className={input} value={f.audience} onChange={set("audience")}>
                {Object.entries(AUDIENCE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl}>מ־ (רשות)</label>
              <input type="datetime-local" className={input} dir="ltr" value={f.starts_at} onChange={set("starts_at")} />
            </div>
            <div>
              <label className={lbl}>עד (רשות)</label>
              <input type="datetime-local" className={input} dir="ltr" value={f.ends_at} onChange={set("ends_at")} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
            <input type="checkbox" checked={f.active} onChange={set("active")} /> פעילה
          </label>
        </div>

        <div>
          <p className={lbl}>תצוגה מקדימה</p>
          <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60 p-4">
            <div className="mx-auto max-w-sm rounded-t-2xl rounded-b-lg bg-white dark:bg-slate-800 shadow-lg p-5 space-y-3">
              <div className="mx-auto h-1 w-10 rounded-full bg-slate-300 dark:bg-slate-600" />
              <h4 className="text-lg font-bold text-slate-900 dark:text-white break-words">{f.title || "כותרת"}</h4>
              <p className="text-sm text-slate-600 dark:text-slate-300 whitespace-pre-line break-words">{f.body || "תוכן ההודעה"}</p>
              {f.button_label && (
                <div className="w-full rounded-xl bg-brand text-white text-center py-2.5 font-semibold text-sm">{f.button_label}</div>
              )}
              <div className="w-full rounded-xl bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-center py-2.5 text-sm">סגירה</div>
            </div>
          </div>
          <pre className="mt-2 text-[11px] text-slate-500 bg-slate-50 dark:bg-slate-900 rounded-lg p-2 overflow-x-auto" dir="ltr">{JSON.stringify(built.json, null, 1)}</pre>
        </div>
      </div>

      {!built.ok && (f.title || f.body || f.id) && (
        <ul className="text-xs text-red-600 dark:text-red-400 list-disc pr-5">{built.errors.map((e) => <li key={e}>{e}</li>)}</ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button disabled={!built.ok || busy} onClick={publish}
          className="px-4 py-2 rounded-lg bg-brand text-white text-sm font-semibold disabled:opacity-50 inline-flex items-center gap-1.5">
          {busy && <Loader2 className="w-4 h-4 animate-spin" />} פרסם
        </button>
        <button disabled={!live || busy} onClick={turnOff}
          className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-sm font-semibold text-slate-700 dark:text-slate-200 disabled:opacity-50">
          כבה
        </button>
        {ok && <span className="text-sm text-emerald-600">{ok}</span>}
      </div>
      {err && <ErrorLine msg={err} />}
    </section>
  )
}

function BroadcastPanel({ teams }) {
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [href, setHref] = useState("")
  const [audience, setAudience] = useState("all_users")
  const [teamId, setTeamId] = useState("")
  const [confirm, setConfirm] = useState(null) // { count }
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [ok, setOk] = useState(null)
  const [recent, setRecent] = useState([])

  const loadRecent = () => getRecentBroadcasts().then(setRecent).catch(() => {})
  useEffect(() => { loadRecent() }, [])

  const sortedTeams = useMemo(() => [...teams].sort((a, b) => (a.name || "").localeCompare(b.name || "", "he")), [teams])
  const aud = audience === "team" ? (teamId ? `team:${teamId}` : "") : audience
  const hrefOk = !href.trim() || (/^\/(?!\/)\S*$/.test(href.trim()) && href.trim().length <= 300)
  const valid = title.trim() && title.trim().length <= 80 && body.trim() && body.trim().length <= 500 && aud && hrefOk
  const payload = { title: title.trim(), body: body.trim(), href: href.trim(), audience: aud }

  const askConfirm = async () => {
    setBusy(true); setErr(null); setOk(null)
    try { setConfirm({ count: await countBroadcastRecipients(payload) }) }
    catch (e) { setErr(broadcastError(e)) } finally { setBusy(false) }
  }
  const send = async () => {
    setBusy(true); setErr(null)
    try {
      const n = await sendBroadcast(payload)
      setOk(`נשלח ל־${n} משתמשים ✓`); setConfirm(null)
      setTitle(""); setBody(""); setHref("")
      loadRecent()
    } catch (e) { setErr(broadcastError(e)); setConfirm(null) } finally { setBusy(false) }
  }

  const input = "w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
  const lbl = "block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1"
  const audLabel = (a) => a === "all_users" ? "כל המשתמשים" : a === "app_users" ? "משתמשי האפליקציה"
    : a?.startsWith("team:") ? `קבוצה: ${teams.find((t) => `team:${t.id}` === a)?.name || "?"}` : a

  return (
    <section className="card p-4 sm:p-5 space-y-4">
      <div className="flex items-start gap-3">
        <Send className="w-5 h-5 text-brand mt-0.5 shrink-0" />
        <div>
          <h3 className="font-semibold text-slate-800 dark:text-slate-100">שליחת התראה לכולם</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            התראה בפעמון + פוש לכל המכשירים של הנמענים. עד 3 שליחות בשעה. אין ביטול אחרי שליחה.
          </p>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={lbl}>כותרת ({title.trim().length}/80)</label>
          <input className={input} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} />
        </div>
        <div>
          <label className={lbl}>קישור באתר (רשות)</label>
          <input className={input} dir="ltr" value={href} onChange={(e) => setHref(e.target.value)} placeholder="/games" />
          {!hrefOk && <p className="text-xs text-red-500 mt-1">נתיב באתר בלבד, מתחיל ב־/</p>}
        </div>
        <div className="sm:col-span-2">
          <label className={lbl}>תוכן ({body.trim().length}/500)</label>
          <textarea className={`${input} min-h-[72px]`} value={body} onChange={(e) => setBody(e.target.value)} maxLength={500} />
        </div>
        <div>
          <label className={lbl}>נמענים</label>
          <select className={input} value={audience} onChange={(e) => setAudience(e.target.value)}>
            <option value="all_users">כל המשתמשים</option>
            <option value="app_users">משתמשי האפליקציה (עם מכשיר רשום)</option>
            <option value="team">קבוצה — אוהדים + סגל</option>
          </select>
        </div>
        {audience === "team" && (
          <div>
            <label className={lbl}>קבוצה</label>
            <select className={input} value={teamId} onChange={(e) => setTeamId(e.target.value)}>
              <option value="">בחירה…</option>
              {sortedTeams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
        )}
      </div>

      {confirm ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700 p-3 space-y-2">
          <p className="text-sm text-amber-900 dark:text-amber-200">
            לשלוח את „{payload.title}“ ל־<b dir="ltr">{confirm.count}</b> משתמשים ({audLabel(aud)})? אי אפשר לבטל.
          </p>
          <div className="flex gap-2">
            <button disabled={busy || !confirm.count} onClick={send}
              className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold disabled:opacity-50 inline-flex items-center gap-1.5">
              {busy && <Loader2 className="w-4 h-4 animate-spin" />} שליחה
            </button>
            <button disabled={busy} onClick={() => setConfirm(null)}
              className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-sm inline-flex items-center gap-1"><X className="w-4 h-4" /> ביטול</button>
          </div>
        </div>
      ) : (
        <button disabled={!valid || busy} onClick={askConfirm}
          className="px-4 py-2 rounded-lg bg-brand text-white text-sm font-semibold disabled:opacity-50 inline-flex items-center gap-1.5">
          {busy && <Loader2 className="w-4 h-4 animate-spin" />} המשך לאישור
        </button>
      )}
      {ok && <p className="text-sm text-emerald-600">{ok}</p>}
      {err && <ErrorLine msg={err} />}

      {recent.length > 0 && (
        <div>
          <p className={lbl}>שליחות אחרונות</p>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
            {recent.map((b) => (
              <li key={b.id} className="py-2 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                <span className="font-semibold text-slate-800 dark:text-slate-100">📣 {b.title}</span>
                <span className="text-xs text-slate-500">{audLabel(b.audience)} · <span dir="ltr">{b.recipients}</span> נמענים</span>
                <span className="text-xs text-slate-400" dir="ltr">{new Date(b.created_at).toLocaleString("he-IL")}</span>
                <span className="text-xs text-slate-400">{b.sent_email}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
