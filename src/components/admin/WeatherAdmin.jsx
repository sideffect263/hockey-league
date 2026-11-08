import { useEffect, useMemo, useState } from "react"
import { RefreshCw, Loader2, Play, CloudRain, Save, RotateCcw } from "lucide-react"
import {
  WEATHER_DEFAULTS, getWeatherSettings, saveWeatherSettings, getWeatherChecks, getLastWeatherCheck,
  getWeatherRecipientCounts, runWeatherWatch,
} from "@/lib/weather"
import { getVenues } from "@/lib/venues"
import { SkeletonPanelRows } from "@/components/skeletons/PageSkeletons"

/**
 * מזג אוויר — the rain decision engine (supabase/functions/weather-watch) + the
 * game-page weather card. Everything here is league_settings 'weather' (read by the
 * engine every hour, and by the card on web + apps), plus the engine's stored
 * verdicts (game_weather_checks). Admins edit + run; league managers see it read-only
 * (league_settings writes and the run endpoint are admin-only).
 */

const LEVEL = {
  move: { label: "להעביר / לדחות", cls: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200" },
  watch: { label: "במעקב", cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200" },
  ok: { label: "תקין", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200" },
}
const card = "rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4"
const h3 = "text-[15px] font-bold text-slate-800 dark:text-slate-100"
const hint = "text-xs text-slate-500 dark:text-slate-400"
const btn = "inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
const btnPrimary = "inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 hover:opacity-90 disabled:opacity-50"

const ilWhen = (iso) => iso ? new Date(iso).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem", weekday: "short", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"

// The tunable numbers, grouped as the engine applies them.
const NUM_GROUPS = [
  { title: "תזמון", fields: [
    ["card_lead_days", "כרטיס בעמוד המשחק — כמה ימים לפני", "ימים"],
    ["horizon_hours", "המנוע בודק משחקים בטווח של", "שעות"],
    ["before_hours", "שעות לפני הפתיחה שנבדקות (רצפה רטובה)", "שעות"],
    ["game_hours", "משך המשחק שנבדק אחרי הפתיחה", "שעות"],
    ["clash_hours", "מגרש חלופי פנוי אם אין בו משחק בטווח של ±", "שעות"],
  ] },
  { title: "להעביר / לדחות — מספיק אחד מאלה", fields: [
    ["move_prob", "בשעה כלשהי במשחק: סיכוי לגשם לפחות", "%"],
    ["move_mm_hour", "…וגם כמות באותה שעה לפחות", "מ״מ"],
    ["move_total_mm", "או: סך גשם בזמן המשחק לפחות", "מ״מ"],
    ["move_total_prob", "…עם סיכוי לפחות", "%"],
    ["move_before_mm", "או: גשם בשעות שלפני הפתיחה לפחות", "מ״מ"],
    ["move_gust", "או: משבי רוח לפחות", "קמ״ש"],
  ] },
  { title: "במעקב (נשמר, בלי התראה)", fields: [
    ["watch_prob", "סיכוי לגשם לפחות", "%"],
    ["watch_mm", "או: גשם בשעה כלשהי לפחות", "מ״מ"],
    ["watch_before_mm", "או: גשם לפני הפתיחה לפחות", "מ״מ"],
  ] },
]

export default function WeatherAdmin({ isAdmin = false, games = [], teamsMap = {} }) {
  const [cfg, setCfg] = useState(null)          // saved
  const [draft, setDraft] = useState(null)      // being edited
  const [checks, setChecks] = useState(null)
  const [lastRun, setLastRun] = useState(null)
  const [counts, setCounts] = useState(null)
  const [venues, setVenues] = useState([])
  const [err, setErr] = useState(null)
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState(null)

  const load = async () => {
    setErr(null)
    const [c, ch, lr, rc, vs] = await Promise.all([
      getWeatherSettings(true),
      getWeatherChecks().catch(e => { setErr(e.message); return [] }),
      getLastWeatherCheck().catch(() => null),
      isAdmin ? getWeatherRecipientCounts() : Promise.resolve(null),
      getVenues(),
    ])
    const { _updated_at, ...clean } = c
    setCfg({ ...clean, _updated_at }); setDraft(clean); setChecks(ch); setLastRun(lr); setCounts(rc); setVenues(vs)
  }
  useEffect(() => { load() }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = useMemo(() => {
    if (!cfg || !draft) return false
    const { _updated_at, ...saved } = cfg
    return JSON.stringify(saved) !== JSON.stringify(draft)
  }, [cfg, draft])

  if (!draft) return <SkeletonPanelRows />

  const set = (k, v) => { setDraft(d => ({ ...d, [k]: v })); setSavedMsg(null) }
  const save = async () => {
    setSaving(true); setErr(null)
    try { const c = await saveWeatherSettings(draft); setCfg({ ...c, _updated_at: new Date().toISOString() }); setDraft(c); setSavedMsg("נשמר — המנוע והכרטיס ישתמשו בזה מהבדיקה הבאה") }
    catch (e) { setErr(e.message || "השמירה נכשלה") }
    finally { setSaving(false) }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100">מזג אוויר ומנוע הגשם</h2>
          <p className={`${hint} mt-0.5`}>
            {draft.engine_enabled ? "המנוע פעיל" : "המנוע כבוי"} · בודק כל שעה משחקים ב-{draft.horizon_hours} השעות הקרובות · בדיקה אחרונה: {lastRun ? ilWhen(lastRun) : "עוד לא נשמרה"}
          </p>
        </div>
        <button onClick={load} className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" title="רענון" aria-label="רענון">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>
      {err && <p className="text-sm text-red-600 dark:text-red-400">{err}</p>}
      {!isAdmin && <p className={`${hint} ${card}`}>תצוגה בלבד — שינוי הגדרות והרצה ידנית זמינים למנהלי האתר.</p>}

      <ChecksPanel checks={checks} games={games} teamsMap={teamsMap} />

      {isAdmin && <RunPanel games={games} teamsMap={teamsMap} horizon={draft.horizon_hours} onRan={load} />}

      <section className={card}>
        <h3 className={h3}>מתגים</h3>
        <div className="mt-3 space-y-3">
          <Toggle on={draft.card_enabled} disabled={!isAdmin} onChange={v => set("card_enabled", v)}
            label="כרטיס מזג אוויר בעמוד המשחק" sub="אתר + אפליקציות. כבוי = הכרטיס לא מופיע לאף אחד." />
          <Toggle on={draft.engine_enabled} disabled={!isAdmin} onChange={v => set("engine_enabled", v)}
            label="מנוע הגשם (בדיקה כל שעה)" sub="כבוי = לא נבדק כלום ולא נשלחות התראות." />
          <Toggle on={draft.notify_admins} disabled={!isAdmin} onChange={v => set("notify_admins", v)}
            label={`התראה למנהלי האתר${counts ? ` (${counts.admins})` : ""}`} />
          <Toggle on={draft.notify_league_managers} disabled={!isAdmin} onChange={v => set("notify_league_managers", v)}
            label={`התראה למנהלי הליגה${counts ? ` (${counts.league_managers})` : ""}`} />
          <Toggle on={draft.send_all_clear} disabled={!isAdmin} onChange={v => set("send_all_clear", v)}
            label="לשלוח ”התחזית השתפרה“" sub="כשמשחק שסומן להעברה כבר לא בסכנה (עד שעתיים לפני הפתיחה)." />
          <Toggle on={draft.thunder_moves} disabled={!isAdmin} onChange={v => set("thunder_moves", v)}
            label="סופת רעמים = להעביר" />
        </div>
      </section>

      <section className={card}>
        <h3 className={h3}>מגרשים מקורים</h3>
        <p className={`${hint} mt-0.5`}>במגרש מקורה אין כרטיס מזג אוויר, המנוע לא בודק אותו, והוא תמיד מוצע כחלופה יבשה כשהוא פנוי.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {venues.map(v => {
            const on = draft.indoor_venues.includes(v.name.trim())
            return (
              <button key={v.id} type="button" disabled={!isAdmin}
                onClick={() => set("indoor_venues", on ? draft.indoor_venues.filter(n => n !== v.name.trim()) : [...draft.indoor_venues, v.name.trim()])}
                className={`px-3 py-1.5 rounded-full text-sm border ${on ? "bg-slate-900 text-white border-slate-900 dark:bg-slate-100 dark:text-slate-900" : "border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200"} ${!isAdmin ? "cursor-default" : ""}`}
                aria-pressed={on}>
                {v.name}{on ? " · מקורה" : ""}{v.lat == null ? " (אין מיקום)" : ""}
              </button>
            )
          })}
        </div>
      </section>

      {NUM_GROUPS.map(g => (
        <section key={g.title} className={card}>
          <h3 className={h3}>{g.title}</h3>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {g.fields.map(([k, label, unit]) => (
              <label key={k} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 px-3 py-2">
                <span className="text-sm text-slate-700 dark:text-slate-200">{label}</span>
                <span className="flex items-center gap-1.5 shrink-0">
                  <input type="number" inputMode="decimal" step="any" min="0" dir="ltr" disabled={!isAdmin}
                    value={draft[k]} onChange={e => set(k, e.target.value === "" ? "" : Number(e.target.value))}
                    className="w-20 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 py-1 text-sm text-center" />
                  <span className="text-xs text-slate-500 w-10">{unit}</span>
                </span>
              </label>
            ))}
          </div>
        </section>
      ))}

      {isAdmin && (
        <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white/95 dark:bg-slate-900/95 p-3">
          <button onClick={save} disabled={!dirty || saving} className={btnPrimary}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} שמירה
          </button>
          <button onClick={() => { setDraft({ ...WEATHER_DEFAULTS, indoor_venues: draft.indoor_venues }); setSavedMsg(null) }} className={btn}>
            <RotateCcw className="w-4 h-4" /> ספים ברירת מחדל
          </button>
          <span className={hint}>{savedMsg || (dirty ? "יש שינויים שלא נשמרו" : cfg?._updated_at ? `עודכן ${ilWhen(cfg._updated_at)}` : "")}</span>
        </div>
      )}
    </div>
  )
}

function gameName(g, teamsMap) {
  if (!g) return "משחק"
  return `${teamsMap[g.home_team_id]?.name ?? ""} נגד ${teamsMap[g.away_team_id]?.name ?? ""}`
}

function LevelBadge({ level }) {
  const l = LEVEL[level] || LEVEL.ok
  return <span className={`shrink-0 text-xs font-bold px-2 py-0.5 rounded-full ${l.cls}`}>{l.label}</span>
}

function Alternatives({ list }) {
  if (!list?.length) return <span>אין מגרש חלופי יבש ופנוי</span>
  return <span>חלופה: {list.map(a => `${a.venue}${a.indoor ? " (מקורה)" : ""} · ${a.km} ק״מ`).join(" / ")}</span>
}

/** What the hourly engine last decided for each game ahead. */
function ChecksPanel({ checks, games, teamsMap }) {
  const byId = useMemo(() => Object.fromEntries(games.map(g => [g.id, g])), [games])
  return (
    <section className={card}>
      <h3 className={h3}>משחקים שנבדקו</h3>
      <p className={`${hint} mt-0.5`}>ההחלטה האחרונה של המנוע לכל משחק קרוב. מתעדכן כל שעה.</p>
      {checks === null ? <SkeletonPanelRows /> : checks.length === 0 ? (
        <p className="text-sm text-slate-500 mt-3">אין כרגע משחקים בטווח הבדיקה.</p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
          {checks.map(c => (
            <li key={c.game_id} className="py-2.5 flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2">
                <a href={`/games/${c.game_id}`} className="text-sm font-semibold text-slate-800 dark:text-slate-100 hover:underline truncate">{gameName(byId[c.game_id], teamsMap)}</a>
                <LevelBadge level={c.level} />
              </div>
              <p className={hint}>{ilWhen(c.kickoff)} · {c.venue}{c.details?.metrics ? ` · ${c.details.metrics.max_prob}% סיכוי · ${c.details.metrics.rain_mm} מ״מ` : ""}</p>
              {c.reasons?.length > 0 && <p className="text-xs text-slate-700 dark:text-slate-300">{c.reasons.join(" · ")}</p>}
              {c.level === "move" && <p className="text-xs text-slate-700 dark:text-slate-300"><Alternatives list={c.details?.alternatives} /></p>}
              {c.notified_at && <p className={hint}>נשלחה התראה {ilWhen(c.notified_at)}{c.details?.notified_count ? ` ל-${c.details.notified_count} אנשים` : ""}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** Run the engine by hand: a preview (nothing saved/sent), a rain simulation, or for real. */
function RunPanel({ games, teamsMap, horizon, onRan }) {
  const [busy, setBusy] = useState(null)
  const [res, setRes] = useState(null)
  const [err, setErr] = useState(null)
  const [simGame, setSimGame] = useState("")
  const upcoming = useMemo(() => games
    .filter(g => g.status === "scheduled" && !g.is_test && new Date(g.game_date) > new Date()
      && new Date(g.game_date) - Date.now() < 16 * 86400 * 1000)
    .sort((a, b) => new Date(a.game_date) - new Date(b.game_date)), [games])

  const run = async (kind) => {
    setBusy(kind); setErr(null); setRes(null)
    try {
      const opts = kind === "preview" ? { dry: true, horizon_hours: 384 }
        : kind === "sim" ? { dry: true, horizon_hours: 384, simulate_rain: true, game_id: simGame }
        : {}
      const r = await runWeatherWatch(opts)
      setRes({ kind, ...r })
      if (kind === "live") onRan?.()
    } catch (e) { setErr(e.message || "ההרצה נכשלה") }
    finally { setBusy(null) }
  }

  return (
    <section className={card}>
      <h3 className={h3}>הרצה ובדיקה</h3>
      <p className={`${hint} mt-0.5`}>
        ”תצוגה“ בודקת את כל המשחקים של 16 הימים הקרובים בלי לשמור ובלי לשלוח. ”הרצה עכשיו“ עושה בדיוק מה שהבדיקה השעתית עושה ({horizon} שעות) — כולל התראות.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button onClick={() => run("preview")} disabled={!!busy} className={btn}>
          {busy === "preview" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />} תצוגה (בלי לשלוח)
        </button>
        <button onClick={() => { if (window.confirm("להריץ עכשיו? אם משחק צריך לעבור — תישלח התראה אמיתית.")) run("live") }} disabled={!!busy} className={btn}>
          {busy === "live" ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} הרצה עכשיו
        </button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select value={simGame} onChange={e => setSimGame(e.target.value)} className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 py-2 text-sm max-w-full">
          <option value="">בחרו משחק לסימולציית גשם…</option>
          {upcoming.map(g => <option key={g.id} value={g.id}>{gameName(g, teamsMap)} · {ilWhen(g.game_date)}</option>)}
        </select>
        <button onClick={() => run("sim")} disabled={!!busy || !simGame} className={btn}>
          {busy === "sim" ? <Loader2 className="w-4 h-4 animate-spin" /> : <CloudRain className="w-4 h-4" />} סימולציית גשם
        </button>
      </div>
      <p className={`${hint} mt-1`}>סימולציה = ”יורד גשם חזק במגרש הזה“: מראה את ההחלטה, החלופה וההתראה שהייתה נשלחת. לא נשמר ולא נשלח.</p>
      {err && <p className="text-sm text-red-600 dark:text-red-400 mt-3">{err}</p>}
      {res && (
        <div className="mt-3 space-y-2">
          <p className={hint}>{res.dry ? "תצוגה — לא נשמר ולא נשלח" : "הרצה אמיתית"} · נבדקו {res.checked} משחקים{res.skipped ? ` · ${res.skipped}` : ""}</p>
          {(res.results || []).map(r => (
            <div key={r.game_id} className="rounded-lg bg-slate-50 dark:bg-slate-800/60 p-3">
              {r.skipped || r.error ? <p className="text-sm text-slate-600">{r.match || r.game_id}: {r.skipped || r.error}</p> : <>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">{r.match}</span>
                  <LevelBadge level={r.level} />
                </div>
                <p className={hint}>{r.when} · {r.venue} · {r.metrics?.max_prob}% סיכוי · {r.metrics?.rain_mm} מ״מ במשחק · {r.metrics?.before_mm} מ״מ לפני · רוח עד {r.metrics?.max_gust} קמ״ש</p>
                {r.reasons?.length > 0 && <p className="text-xs text-slate-700 dark:text-slate-300 mt-0.5">{r.reasons.join(" · ")}</p>}
                {r.level === "move" && <p className="text-xs text-slate-700 dark:text-slate-300"><Alternatives list={r.alternatives} /></p>}
                {r.push && (
                  <div className="mt-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-2.5">
                    <p className="text-[11px] text-slate-500">{res.dry ? "ההתראה שהייתה נשלחת:" : "נשלחה התראה:"}</p>
                    <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{r.push.title}</p>
                    <p className="text-sm text-slate-700 dark:text-slate-300">{r.push.body}</p>
                  </div>
                )}
              </>}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function Toggle({ on, onChange, label, sub, disabled }) {
  return (
    <label className={`flex items-start justify-between gap-3 ${disabled ? "" : "cursor-pointer"}`}>
      <span>
        <span className="block text-sm font-semibold text-slate-800 dark:text-slate-100">{label}</span>
        {sub && <span className={`block ${hint}`}>{sub}</span>}
      </span>
      <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
        className={`relative shrink-0 w-11 h-6 rounded-full transition-colors ${on ? "bg-emerald-600" : "bg-slate-300 dark:bg-slate-600"} ${disabled ? "opacity-60" : ""}`}>
        <span className={`absolute top-0.5 size-5 rounded-full bg-white transition-all ${on ? "left-0.5" : "left-[22px]"}`} />
      </button>
    </label>
  )
}
