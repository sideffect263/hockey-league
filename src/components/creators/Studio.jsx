import { useState, useEffect, useMemo, useCallback, useRef } from "react"
import { Link } from "react-router-dom"
import { ArrowRight, ArrowLeft, Check, Loader2, Copy, Download, Send, Trash2, X, Search, Play, Image as ImageIcon, Smartphone, Monitor, ChevronDown, Upload } from "lucide-react"
import { Sparkle as Sparkles, Warning as AlertTriangle, Film as Clapperboard, Film, Flame, BrandIcon } from "@/components/icons/BrandIcons"
import FeedVideo from "@/components/feed/FeedVideo"
import { getGames, getTeams } from "@/lib/api"
import { deleteFeedDraft, publishFeedDraft, requestGoalReel, getLatestGoalReel, goalReelDownloadUrl } from "@/lib/feedDrafts"
import { supabase } from "@/lib/supabase"
import { uploadFeedVideo, MAX_FEED_VIDEO_MB } from "@/lib/feedVideo"
import {
  CONTENT_TYPES, TYPE_BY_ID, OUTPUTS, OUTPUT_BY_ID, DEFAULT_OUTPUTS, SOURCE_LABEL, loadPool, buildCaptions, suggestText,
  gameDays, getKits, createKit, updateKit, kitState, downloadFile, streamThumb, firstLine,
} from "@/lib/studio"

/**
 * /creators → "סטודיו": the content creator's workspace (Ariel 2026-10-19). A volunteer picks WHAT to make
 * (7 kinds), picks media from one pool, picks WHERE it goes, and gets a kit: the files per format and a
 * caption per platform with a copy button. The site feed is published from here; Instagram / Facebook /
 * TikTok / WhatsApp are posted by hand from the kit. Each kit is a feed_drafts row (creators-studio.sql).
 */
export default function Studio({ onCountChange }) {
  const [kits, setKits] = useState(null)
  const [err, setErr] = useState(null)
  const [type, setType] = useState(null)          // the wizard is open while a type is chosen
  const [ctx, setCtx] = useState({ games: [], teams: {} })

  const load = useCallback(async () => {
    try { setKits(await getKits()); setErr(null) } catch (e) { console.error(e); setErr("טעינת הערכות נכשלה") }
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => { onCountChange?.(kits?.length ?? 0) }, [kits, onCountChange])
  // While the video worker is still making something (a 9:16 version, a game play), refresh quietly.
  const working = (kits || []).some(k => ["queued", "processing"].includes(k.status) || ["queued", "processing"].includes(k.assets?.vertical?.status))
  useEffect(() => {
    if (!working || type) return
    const t = setInterval(() => getKits().then(setKits).catch(() => {}), 20000)
    return () => clearInterval(t)
  }, [working, type])
  useEffect(() => {
    Promise.all([getGames("game_date", false), getTeams()]).then(([games, teams]) =>
      setCtx({ games: games || [], teams: Object.fromEntries((teams || []).map(t => [t.id, t])) })).catch(() => {})
  }, [])

  const gameById = useMemo(() => Object.fromEntries(ctx.games.map(g => [g.id, g])), [ctx.games])
  const teamName = useCallback((id) => ctx.teams[id]?.name || "", [ctx.teams])
  const gameLabel = useCallback((g) => g ? `${teamName(g.home_team_id)} – ${teamName(g.away_team_id)} · ${new Date(g.game_date).toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem", day: "numeric", month: "numeric" })}` : "", [teamName])

  if (type) {
    return <Wizard type={TYPE_BY_ID[type]} ctx={{ ...ctx, gameById, teamName, gameLabel }}
      onCancel={() => setType(null)} onCreated={(kit) => { setType(null); if (kit) setKits(ks => [kit, ...(ks || [])]); else load() }} />
  }

  return (
    <div className="space-y-6">
      <section className="card p-5 sm:p-6">
        <h2 className="text-xl font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-amber-500" /> מה תרצו ליצור היום?
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">בחרו סוג תוכן — נעזור לבחור מדיה, נכין גרסה לאתר וגרסה אנכית לרשתות, וטקסט מוכן לכל פלטפורמה.</p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
          {CONTENT_TYPES.map(t => (
            <button key={t.id} onClick={() => setType(t.id)}
              className="group text-start rounded-2xl border-2 border-slate-200 dark:border-slate-700 p-4 hover:border-brand hover:bg-brand/[0.04] dark:hover:bg-brand/10 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-brand">
              <BrandIcon name={t.icon} className="w-9 h-9" />
              <span className="block mt-2 font-bold text-slate-900 dark:text-white group-hover:text-brand">{t.title}</span>
              <span className="block mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{t.hint}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="font-bold text-slate-900 dark:text-white">הערכות שלכם</h2>
          <span className="text-xs text-slate-500 dark:text-slate-400">{kits?.length ? `${kits.length} ערכות` : ""}</span>
        </div>
        {err && <p className="text-sm text-red-600">{err}</p>}
        {kits === null && !err && <div className="card p-8 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>}
        {kits?.length === 0 && (
          <div className="card p-8 text-center text-sm text-slate-500 dark:text-slate-400">עוד אין ערכות. בחרו למעלה מה ליצור.</div>
        )}
        {(kits || []).map(k => (
          <KitCard key={k.id} kit={k} game={gameById[k.game_id]} gameLabel={gameLabel} teamName={teamName}
            onGone={() => setKits(ks => ks.filter(x => x.id !== k.id))} onChange={(patch) => setKits(ks => ks.map(x => x.id === k.id ? { ...x, ...patch } : x))} />
        ))}
      </section>
    </div>
  )
}

/* ──────────────────────────── the wizard ──────────────────────────── */

const STEPS = [
  { id: "media", label: "מדיה" },
  { id: "outputs", label: "לאן" },
  { id: "text", label: "טקסט וסיום" },
]

function Wizard({ type, ctx, onCancel, onCreated }) {
  if (type.id === "goals_summary") return <GoalsSummary onCancel={onCancel} onDone={() => onCreated(null)} />
  return <KitWizard type={type} ctx={ctx} onCancel={onCancel} onCreated={onCreated} />
}

function KitWizard({ type, ctx, onCancel, onCreated }) {
  const [step, setStep] = useState(0)
  const [items, setItems] = useState([])       // picked pool items, in pick order
  const [day, setDay] = useState(null)         // round_results / round_preview
  const [story, setStory] = useState(null)     // game_story
  const [range, setRange] = useState(null)     // game_play { start_s, end_s }
  const [outputs, setOutputs] = useState(DEFAULT_OUTPUTS)
  const [text, setText] = useState("")
  const [textTouched, setTextTouched] = useState(false)
  const [brief, setBrief] = useState("")
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState(null)

  const game = useMemo(() => {
    if (story) return ctx.gameById[story.game_id] || null
    const id = items.find(i => i.gameId)?.gameId
    return id ? ctx.gameById[id] || null : null
  }, [items, story, ctx.gameById])

  // Keep the suggested text in step with the picks until the creator edits it.
  useEffect(() => {
    if (textTouched) return
    setText(suggestText({ type: type.id, items, game, day, story, teamName: ctx.teamName }))
  }, [type.id, items, game, day, story, ctx.teamName, textTouched])

  const [min, max] = type.pick
  const mediaOk = (type.gameDay ? !!day : true) && (type.story ? !!story : true)
    && items.length >= min && items.length <= Math.max(max, min) && (!type.range || (range && range.end_s > range.start_s))
  const canNext = [mediaOk, outputs.length > 0, text.trim().length > 0 && (!type.brief || brief.trim().length >= 10)][step]

  const linkPath = story || game ? `/games/${(story ? ctx.gameById[story.game_id] : game)?.slug || game?.id}` : null
  const teams = game ? [ctx.teamName(game.home_team_id), ctx.teamName(game.away_team_id)] : day ? [...new Set(day.games.flatMap(g => [ctx.teamName(g.home_team_id), ctx.teamName(g.away_team_id)]))] : []
  const captions = useMemo(() => buildCaptions({ text, teams, link: linkPath, outputs }), [text, teams.join("|"), linkPath, outputs]) // eslint-disable-line react-hooks/exhaustive-deps

  const finish = async () => {
    setBusy(0); setErr(null)
    try {
      const storyItems = story?.hero_image_url ? [{ source: "story", id: story.game_id, label: story.title, image: story.hero_image_url, gameId: story.game_id }] : []
      const kit = await createKit({
        type: type.id, items: [...items, ...storyItems], outputs, text, captions,
        gameId: game?.id || day?.games?.[0]?.id || null, brief: type.brief ? brief : null, range: type.range ? range : null,
        onProgress: (p) => setBusy(p),
      })
      onCreated(kit)
    } catch (e) {
      console.error(e)
      setErr(e?.message === "too_big" ? "הקליפ גדול מדי להעלאה" : "יצירת הערכה נכשלה — נסו שוב")
      setBusy(null)
    }
  }

  return (
    <div className="card p-4 sm:p-6 space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
          <BrandIcon name={type.icon} className="w-7 h-7" /> {type.title}
        </h2>
        <button onClick={onCancel} className="inline-flex items-center gap-1 text-sm font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-white">
          <X className="w-4 h-4" /> ביטול
        </button>
      </div>

      <ol className="flex items-center gap-2 text-xs font-bold" aria-label="שלבים">
        {STEPS.map((s, i) => (
          <li key={s.id} className="flex items-center gap-2">
            <span className={`w-6 h-6 rounded-full flex items-center justify-center ${i < step ? "bg-emerald-500 text-white" : i === step ? "bg-brand text-white" : "bg-slate-200 dark:bg-slate-700 text-slate-500"}`}>
              {i < step ? <Check className="w-3.5 h-3.5" /> : i + 1}
            </span>
            <span className={i === step ? "text-slate-900 dark:text-white" : "text-slate-400"}>{s.label}</span>
            {i < STEPS.length - 1 && <span className="w-6 h-px bg-slate-300 dark:bg-slate-600" />}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <div className="space-y-4">
          {type.gameDay && <DayPicker which={type.gameDay} games={ctx.games} teamName={ctx.teamName} day={day} onPick={setDay} />}
          {type.story && <StoryPicker ctx={ctx} story={story} onPick={setStory} />}
          {type.pool.length > 0 && (
            <>
              {(type.gameDay || type.story) && <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">אפשר להוסיף גם תמונות או קליפים (לא חובה)</p>}
              <MediaPool sources={type.pool} max={max} selected={items} onChange={setItems} ctx={ctx}
                preferGame={day?.games?.map(g => g.id) || null} goalsFirst={type.id === "goal"} />
            </>
          )}
          {type.range && items[0] && <RangePicker item={items[0]} range={range} onChange={setRange} />}
        </div>
      )}

      {step === 1 && <OutputPicker outputs={outputs} onChange={setOutputs} hasVideo={items.some(i => i.video || i.cf) || type.worker} />}

      {step === 2 && (
        <div className="space-y-4">
          {type.brief && (
            <div>
              <label className="block text-sm font-bold text-slate-800 dark:text-slate-100 mb-1">מה ראיתם? תארו את המהלך במילים שלכם</label>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">למשל: "#7 של מוצקין חוסם לשוער את קו הראייה רגע לפני הבעיטה". מי המעורבים, מה קרה ולמה זה מעניין.</p>
              <textarea value={brief} onChange={e => setBrief(e.target.value.slice(0, 2000))} rows={4}
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30" />
            </div>
          )}
          <div>
            <label className="block text-sm font-bold text-slate-800 dark:text-slate-100 mb-1">הטקסט של הפוסט</label>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">הכנו טיוטה — שנו בחופשיות. ממנה נבנה הטקסט לכל פלטפורמה.</p>
            <textarea value={text} onChange={e => { setText(e.target.value.slice(0, 2000)); setTextTouched(true) }} rows={type.gameDay ? 8 : 4}
              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30" />
          </div>
          <CaptionPreview captions={captions} />
          {type.worker && (
            <p className="flex gap-2 text-xs text-blue-800 dark:text-blue-200 bg-blue-50 dark:bg-blue-900/20 rounded-xl px-3 py-2.5">
              <Clapperboard className="w-4 h-4 shrink-0" /> הסרטון ייווצר במחשב הווידאו של הליגה. הערכה תופיע ברשימה עם הסטטוס "ממתין לעיבוד" ותתעדכן כשהסרטון מוכן.
            </p>
          )}
        </div>
      )}

      {err && <p className="text-sm text-red-600 dark:text-red-400 font-medium">{err}</p>}

      <div className="flex items-center justify-between gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
        <button onClick={() => (step === 0 ? onCancel() : setStep(step - 1))} disabled={busy != null}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-full text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">
          <ArrowRight className="w-4 h-4" /> {step === 0 ? "חזרה" : "הקודם"}
        </button>
        {step < STEPS.length - 1 ? (
          <button onClick={() => setStep(step + 1)} disabled={!canNext}
            className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-full bg-brand text-white text-sm font-bold hover:bg-brand-hover disabled:opacity-40">
            הבא <ArrowLeft className="w-4 h-4" />
          </button>
        ) : (
          <button onClick={finish} disabled={!canNext || busy != null}
            className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-full bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700 disabled:opacity-40">
            {busy != null ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {busy != null && busy > 0 && busy < 1 ? `מעלה ${Math.round(busy * 100)}%` : "יצירת הערכה"}
          </button>
        )}
      </div>
      {step === 0 && !mediaOk && <MediaHint type={type} count={items.length} day={day} story={story} range={range} />}
    </div>
  )
}

function MediaHint({ type, count, day, story, range }) {
  const [min, max] = type.pick
  let msg = null
  if (type.gameDay && !day) msg = "בחרו יום משחקים"
  else if (type.story && !story) msg = "בחרו סיפור משחק"
  else if (count < min) msg = min === 1 && max === 1 ? "בחרו פריט אחד" : `בחרו לפחות ${min}`
  else if (type.range && !(range && range.end_s > range.start_s)) msg = "סמנו התחלה וסוף לרגע"
  return msg ? <p className="text-xs text-slate-500 dark:text-slate-400 text-center -mt-2">{msg}</p> : null
}

/* ── media pool ── */

function MediaPool({ sources, max, selected, onChange, ctx, preferGame, goalsFirst }) {
  const [pool, setPool] = useState(null)
  const [uploads, setUploads] = useState([])   // videos uploaded in this session (own footage)
  const [upBusy, setUpBusy] = useState(null)
  const fileRef = useRef(null)
  const canUpload = sources.some(s => s === "lab_clip" || s === "post" || s === "game_media")
  const upload = async (file) => {
    if (!file) return
    setUpBusy(0)
    try {
      const v = await uploadFeedVideo(file, setUpBusy)
      const item = { key: `upload:${v.uid}`, source: "upload", id: v.uid, label: file.name.replace(/\.[^.]+$/, ""), date: new Date().toISOString(),
        cf: { uid: v.uid, code: v.cfCode, ratio: v.ratio }, thumb: null }
      setUploads(u => [item, ...u])
      if (max === 1) onChange([item]); else if (selected.length < max) onChange([...selected, item])
    } catch (e) { window.alert(e?.message === "too_big" ? `הקובץ גדול מ-${MAX_FEED_VIDEO_MB}MB` : "ההעלאה נכשלה") }
    finally { setUpBusy(null); if (fileRef.current) fileRef.current.value = "" }
  }
  const [source, setSource] = useState("all")
  const [gameId, setGameId] = useState("")
  const [q, setQ] = useState("")
  const [preview, setPreview] = useState(null)

  useEffect(() => { let alive = true; loadPool(sources).then(p => alive && setPool(p)); return () => { alive = false } }, [sources.join(",")]) // eslint-disable-line react-hooks/exhaustive-deps

  const games = useMemo(() => {
    const ids = [...new Set((pool || []).map(i => i.gameId).filter(Boolean))]
    return ids.map(id => ctx.gameById[id]).filter(Boolean).sort((a, b) => b.game_date.localeCompare(a.game_date))
  }, [pool, ctx.gameById])

  const shown = useMemo(() => {
    let list = [...uploads, ...(pool || [])].filter(i => (source === "all" || i.source === source) && (!gameId || i.gameId === gameId))
    if (q.trim()) { const s = q.trim(); list = list.filter(i => `${i.label} ${i.album || ""}`.includes(s)) }
    const prefer = new Set(preferGame || [])
    return [...list].sort((a, b) =>
      (prefer.has(b.gameId) - prefer.has(a.gameId)) || (goalsFirst ? (b.isGoal ? 1 : 0) - (a.isGoal ? 1 : 0) : 0) || String(b.date || "").localeCompare(String(a.date || "")))
  }, [pool, uploads, source, gameId, q, preferGame, goalsFirst])

  const sel = new Map(selected.map((s, i) => [s.key, i + 1]))
  const toggle = (item) => {
    if (sel.has(item.key)) onChange(selected.filter(s => s.key !== item.key))
    else if (max === 1) onChange([item])
    else if (selected.length < max) onChange([...selected, item])
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {sources.length > 1 && (
          <div className="flex rounded-full bg-slate-100 dark:bg-slate-800 p-1 text-xs font-semibold">
            {["all", ...sources].map(s => (
              <button key={s} onClick={() => setSource(s)}
                className={`px-3 py-1.5 rounded-full ${source === s ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm" : "text-slate-500"}`}>
                {s === "all" ? "הכל" : SOURCE_LABEL[s]}
              </button>
            ))}
          </div>
        )}
        {games.length > 0 && (
          <select value={gameId} onChange={e => setGameId(e.target.value)} className="filter-input text-sm py-1.5">
            <option value="">כל המשחקים</option>
            {games.map(g => <option key={g.id} value={g.id}>{ctx.gameLabel(g)}</option>)}
          </select>
        )}
        {canUpload && (
          <>
            <input ref={fileRef} type="file" accept="video/*" className="hidden" onChange={e => upload(e.target.files?.[0])} />
            <button onClick={() => fileRef.current?.click()} disabled={upBusy != null}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700">
              {upBusy != null ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
              {upBusy != null ? `מעלה ${Math.round(upBusy * 100)}%` : "העלאה מהמחשב"}
            </button>
          </>
        )}
        <label className="relative flex-1 min-w-[10rem]">
          <Search className="w-4 h-4 absolute top-1/2 -translate-y-1/2 start-3 text-slate-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="חיפוש לפי שם, שחקן, אלבום…" className="filter-input w-full text-sm ps-9 py-1.5" />
        </label>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        {max === 1 ? "בחרו פריט אחד" : `נבחרו ${selected.length}${max ? ` מתוך עד ${max}` : ""}`} · לחיצה על ▶ מציגה תצוגה מקדימה
      </p>

      {pool === null ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => <div key={i} className="aspect-video rounded-xl bg-slate-100 dark:bg-slate-800 animate-pulse" />)}
        </div>
      ) : shown.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-600 p-8 text-center text-sm text-slate-500">לא נמצאה מדיה כאן</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 max-h-[28rem] overflow-y-auto pe-1">
          {shown.map(item => {
            const n = sel.get(item.key)
            const isVideo = !!(item.video || item.cf)
            return (
              <div key={item.key} className={`relative rounded-xl overflow-hidden border-2 transition-all ${n ? "border-brand ring-2 ring-brand/30" : "border-transparent"}`}>
                <button onClick={() => toggle(item)} className="block w-full text-start" aria-pressed={!!n}>
                  <div className="aspect-video bg-slate-200 dark:bg-slate-800 flex items-center justify-center overflow-hidden">
                    {item.thumb
                      ? <img src={item.thumb} alt="" loading="lazy" className="w-full h-full object-cover" />
                      : item.video
                        // No Cloudflare copy → the clip's own frame (metadata + one frame, not the whole file).
                        ? <video src={`${item.video}#t=${Math.max(1, Math.round((item.duration || 4) / 2))}`} preload="metadata" muted playsInline className="w-full h-full object-cover pointer-events-none" />
                        : isVideo ? <Film className="w-8 h-8 text-slate-400" /> : <ImageIcon className="w-8 h-8 text-slate-400" />}
                  </div>
                  <div className="p-2 bg-white dark:bg-slate-900">
                    <p className="text-xs font-semibold text-slate-800 dark:text-slate-100 line-clamp-2 leading-snug">{item.label}</p>
                    <p className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-1">
                      {isVideo ? <Film className="w-4 h-4" /> : <ImageIcon className="w-3 h-3" />}
                      {item.isGoal ? "גול · " : ""}{item.duration ? `${Math.round(item.duration)} שנ׳ · ` : ""}
                      {item.gameId && ctx.gameById[item.gameId] ? ctx.gameLabel(ctx.gameById[item.gameId]) : SOURCE_LABEL[item.source]}
                    </p>
                  </div>
                </button>
                {n && <span className="absolute top-2 end-2 w-7 h-7 rounded-full bg-brand text-white text-sm font-bold flex items-center justify-center shadow">{max === 1 ? <Check className="w-4 h-4" /> : n}</span>}
                {isVideo && (
                  <button onClick={() => setPreview(item)} aria-label="תצוגה מקדימה"
                    className="absolute top-2 start-2 w-8 h-8 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80">
                    <Play className="w-4 h-4" />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
      {preview && <PreviewModal item={preview} onClose={() => setPreview(null)} />}
    </div>
  )
}

function PreviewModal({ item, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label={item.label}>
      <div className="w-full max-w-3xl" onClick={e => e.stopPropagation()}>
        <MediaVideo item={item} autoPlay />
        <div className="flex items-center justify-between mt-2 text-white">
          <p className="text-sm font-semibold">{item.label}</p>
          <button onClick={onClose} className="inline-flex items-center gap-1 text-sm"><X className="w-4 h-4" /> סגירה</button>
        </div>
      </div>
    </div>
  )
}

/** A pool item's video: the rendered file when there is one (exact frames), else the Stream player. */
function MediaVideo({ item, autoPlay = false, videoRef = null }) {
  if (item.video) {
    return <video ref={videoRef} src={item.video} controls playsInline autoPlay={autoPlay} muted={autoPlay} preload="metadata" className="w-full rounded-xl bg-black aspect-video" />
  }
  if (item.cf) {
    return <FeedVideo provider="cloudflare" videoId={item.cf.uid} cfCode={item.cf.code} ratio={item.cf.ratio} poster={streamThumb(item.cf.code, item.cf.uid)} title={item.label} />
  }
  return null
}

/** Game play: mark the moment (start / end) on the clip. */
function RangePicker({ item, range, onChange }) {
  const ref = useRef(null)
  const now = () => Math.round((ref.current?.currentTime || 0) * 10) / 10
  const set = (k) => onChange({ start_s: range?.start_s ?? 0, end_s: range?.end_s ?? 0, [k]: now() })
  const canMark = !!item.video
  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
      <p className="text-sm font-bold text-slate-800 dark:text-slate-100">סמנו את הרגע: נגנו, עצרו בתחילת המהלך ולחצו "התחלה", ואז בסופו "סוף"</p>
      <MediaVideo item={item} videoRef={ref} />
      {canMark ? (
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => set("start_s")} className="px-3 py-2 rounded-lg text-sm font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200">⏮ התחלה כאן</button>
          <button onClick={() => set("end_s")} className="px-3 py-2 rounded-lg text-sm font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200">⏭ סוף כאן</button>
          <span className="text-sm text-slate-600 dark:text-slate-300" dir="ltr">{range ? `${range.start_s}s → ${range.end_s}s` : "—"}</span>
          {range && range.end_s <= range.start_s && <span className="text-xs text-red-600">הסוף חייב להיות אחרי ההתחלה</span>}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-600 dark:text-slate-300">כתבו את הזמנים בשניות:</span>
          {["start_s", "end_s"].map(key => (
            <input key={key} type="number" min="0" step="0.5" dir="ltr" placeholder={key === "start_s" ? "התחלה" : "סוף"}
              value={range?.[key] ?? ""} onChange={e => onChange({ start_s: range?.start_s ?? 0, end_s: range?.end_s ?? 0, [key]: Number(e.target.value) })}
              className="filter-input w-24 text-sm py-1.5" />
          ))}
        </div>
      )}
    </div>
  )
}

function DayPicker({ which, games, teamName, day, onPick }) {
  const days = useMemo(() => gameDays(games, which).slice(0, 8), [games, which])
  if (!days.length) return <p className="text-sm text-slate-500">{which === "past" ? "אין עדיין ימי משחקים עם תוצאות" : "אין משחקים קרובים בלוח"}</p>
  return (
    <div>
      <p className="text-sm font-bold text-slate-800 dark:text-slate-100 mb-2">{which === "past" ? "איזה יום משחקים?" : "איזה מחזור?"}</p>
      <div className="grid sm:grid-cols-2 gap-2">
        {days.map(d => {
          const active = day?.day === d.day
          return (
            <button key={d.day} onClick={() => onPick(d)}
              className={`text-start rounded-xl border-2 p-3 ${active ? "border-brand bg-brand/[0.05]" : "border-slate-200 dark:border-slate-700 hover:border-slate-300"}`}>
              <p className="font-bold text-sm text-slate-900 dark:text-white">{new Date(d.games[0].game_date).toLocaleDateString("he-IL", { timeZone: "Asia/Jerusalem", weekday: "long", day: "numeric", month: "numeric" })}</p>
              {/* RTL row: home team on the right, so the score reads away:home inside an LTR run (CLAUDE.md gotcha). */}
              <ul className="mt-1 space-y-0.5 text-xs text-slate-600 dark:text-slate-300">
                {d.games.map(g => (
                  <li key={g.id}>{teamName(g.home_team_id)} {which === "past" ? <span dir="ltr" className="font-bold">{g.away_score}–{g.home_score}</span> : "נגד"} {teamName(g.away_team_id)}</li>
                ))}
              </ul>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function StoryPicker({ ctx, story, onPick }) {
  const [stories, setStories] = useState(null)
  useEffect(() => {
    supabase.from("game_stories").select("game_id,title,summary,hero_image_url,published_at").eq("status", "published")
      .order("published_at", { ascending: false }).limit(20)
      .then(({ data }) => setStories(data || []))
  }, [])
  if (stories === null) return <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
  if (!stories.length) return <p className="text-sm text-slate-500">אין עדיין סיפורי משחק שפורסמו — אפשר לאשר אותם בלשונית "סיפורי משחקים".</p>
  return (
    <div className="grid sm:grid-cols-2 gap-2">
      {stories.map(s => {
        const active = story?.game_id === s.game_id
        return (
          <button key={s.game_id} onClick={() => onPick(s)}
            className={`text-start rounded-xl border-2 p-3 flex gap-3 ${active ? "border-brand bg-brand/[0.05]" : "border-slate-200 dark:border-slate-700 hover:border-slate-300"}`}>
            {s.hero_image_url && <img src={s.hero_image_url} alt="" className="w-20 h-14 rounded-lg object-cover shrink-0" loading="lazy" />}
            <span className="min-w-0">
              <span className="block text-sm font-bold text-slate-900 dark:text-white line-clamp-2">{s.title}</span>
              <span className="block text-xs text-slate-500 mt-0.5">{ctx.gameLabel(ctx.gameById[s.game_id])}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

function OutputPicker({ outputs, onChange, hasVideo }) {
  const toggle = (id) => onChange(outputs.includes(id) ? outputs.filter(o => o !== id) : [...outputs, id])
  return (
    <div className="space-y-3">
      <p className="text-sm font-bold text-slate-800 dark:text-slate-100">איפה זה יתפרסם? אפשר לבחור כמה</p>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {OUTPUTS.map(o => {
          const on = outputs.includes(o.id)
          return (
            <button key={o.id} onClick={() => toggle(o.id)} aria-pressed={on}
              className={`text-start rounded-xl border-2 p-3 flex items-start gap-3 ${on ? "border-brand bg-brand/[0.05]" : "border-slate-200 dark:border-slate-700 hover:border-slate-300"}`}>
              <span className={`mt-0.5 w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 ${on ? "bg-brand border-brand text-white" : "border-slate-300"}`}>{on && <Check className="w-3.5 h-3.5" />}</span>
              <span>
                <span className="block font-bold text-sm text-slate-900 dark:text-white">{o.label}</span>
                <span className="block text-xs text-slate-500 mt-0.5">{hasVideo ? `וידאו ${o.format} · ` : ""}{o.hint}</span>
              </span>
            </button>
          )
        })}
      </div>
      {hasVideo && outputs.some(o => o !== "site") && (
        <p className="flex gap-2 text-xs text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800 rounded-xl px-3 py-2.5">
          <Smartphone className="w-4 h-4 shrink-0" /> לרשתות נכין גרסה אנכית (9:16) שעוקבת אחרי הכדור, כך שהשער תמיד בתמונה. היא תופיע בערכה ברגע שתהיה מוכנה.
        </p>
      )}
    </div>
  )
}

function CaptionPreview({ captions }) {
  const [open, setOpen] = useState(false)
  const keys = Object.keys(captions)
  if (!keys.length) return null
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between px-3 py-2.5 text-sm font-semibold text-slate-700 dark:text-slate-200">
        איך זה ייראה בכל פלטפורמה <ChevronDown className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="grid sm:grid-cols-2 gap-2 p-3 pt-0">
          {keys.map(k => (
            <div key={k} className="rounded-lg bg-slate-50 dark:bg-slate-800 p-2.5">
              <p className="text-[11px] font-bold text-slate-500 mb-1">{OUTPUT_BY_ID[k]?.label}</p>
              <p className="text-xs whitespace-pre-line text-slate-700 dark:text-slate-200 leading-relaxed">{captions[k]}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ── goals summary (the existing reel worker) ── */

function GoalsSummary({ onCancel, onDone }) {
  const [reel, setReel] = useState(undefined)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const poll = useCallback(async () => { try { setReel(await getLatestGoalReel()) } catch { setReel(null) } }, [])
  useEffect(() => { poll() }, [poll])
  const running = reel && (reel.status === "queued" || reel.status === "processing")
  useEffect(() => { if (!running) return; const t = setInterval(poll, 5000); return () => clearInterval(t) }, [running, poll])
  const start = async () => {
    setBusy(true); setErr(null)
    try { setReel(await requestGoalReel()) } catch { setErr("לא הצלחנו להתחיל את התקציר") } finally { setBusy(false) }
  }
  const fresh = reel && Date.now() - new Date(reel.updated_at).getTime() < 3 * 864e5
  const dl = reel?.status === "done" && goalReelDownloadUrl(reel.video_path)
  return (
    <div className="card p-5 sm:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-extrabold text-slate-900 dark:text-white flex items-center gap-2"><Flame className="w-7 h-7" /> תקציר גולים</h2>
        <button onClick={onCancel} className="inline-flex items-center gap-1 text-sm font-semibold text-slate-500"><X className="w-4 h-4" /> סגירה</button>
      </div>
      <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
        סרטון אחד עם <b>כל</b> הגולים של יום המשחקים האחרון, בסדר ספירה לאחור — מוזיקה, שמות וסמלים. נוצר אוטומטית במחשב הווידאו (כ-2 דקות) ומופיע ברשימת הערכות.
      </p>
      {running ? (
        <p className="inline-flex items-center gap-2 text-sm font-semibold text-blue-700 dark:text-blue-300"><Loader2 className="w-4 h-4 animate-spin" /> {reel.note || "יוצר תקציר…"}</p>
      ) : (
        <button onClick={start} disabled={busy}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-bold bg-amber-400 text-slate-900 hover:bg-amber-300 disabled:opacity-60">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Clapperboard className="w-4 h-4" />} צרו תקציר גולים
        </button>
      )}
      {!running && fresh && reel.status === "done" && (
        <p className="flex flex-wrap items-center gap-3 text-sm text-emerald-700 dark:text-emerald-400">
          <Check className="w-4 h-4" /> {reel.note}
          {dl && <a href={dl} download className="inline-flex items-center gap-1 font-semibold underline"><Download className="w-4 h-4" /> הורדה</a>}
          <button onClick={onDone} className="font-semibold underline">לרשימת הערכות</button>
        </p>
      )}
      {!running && fresh && reel.status === "error" && <p className="flex gap-1 text-sm text-red-600"><AlertTriangle className="w-4 h-4" /> {reel.note}</p>}
      {err && <p className="text-sm text-red-600">{err}</p>}
    </div>
  )
}

/* ──────────────────────────── a kit ──────────────────────────── */

function KitCard({ kit, game, gameLabel, teamName, onGone, onChange }) {
  const type = TYPE_BY_ID[kit.content_type]
  // Drafts from before the studio (no content_type) still get the network tabs — their text is built from the body.
  const outputs = kit.content_type && kit.outputs?.length ? kit.outputs : DEFAULT_OUTPUTS
  const state = kitState(kit)
  const [tab, setTab] = useState(outputs[0])
  const [view, setView] = useState("h")       // h = 16:9 (site), v = 9:16 (networks)
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState(null)
  const [published, setPublished] = useState(false)
  const [copied, setCopied] = useState(null)

  // Old drafts (before the studio) have no per-platform captions: build them from the body.
  const captions = useMemo(() => {
    const base = buildCaptions({ text: kit.body, teams: game ? [teamName(game.home_team_id), teamName(game.away_team_id)] : [], link: game ? `/games/${game.slug || game.id}` : null, outputs })
    return { ...base, ...(kit.captions || {}), site: kit.body }
  }, [kit.body, kit.captions, game, teamName, outputs.join(",")]) // eslint-disable-line react-hooks/exhaustive-deps
  const [draft, setDraft] = useState(captions[tab] || "")
  useEffect(() => { setDraft(captions[tab] || "") }, [tab, captions])

  const saveCaption = async () => {
    const text = draft.trim()
    if (text === (captions[tab] || "").trim()) return
    setErr(null)
    try {
      const patch = tab === "site" ? { body: text } : { captions: { ...(kit.captions || {}), [tab]: text } }
      await updateKit(kit.id, patch); onChange(patch)
    } catch { setErr("השמירה נכשלה") }
  }
  const copy = async () => {
    try { await navigator.clipboard.writeText(draft); setCopied(tab); setTimeout(() => setCopied(null), 1800) } catch { setErr("ההעתקה נכשלה — סמנו והעתיקו ידנית") }
  }
  const publish = async () => {
    await saveCaption()
    setBusy("publish"); setErr(null)
    try { await publishFeedDraft(kit.id); setPublished(true); setTimeout(onGone, 1800) }
    catch { setErr("הפרסום נכשל"); setBusy(null) }
  }
  const retryVertical = async () => {
    const assets = { ...(kit.assets || {}), vertical: { status: "queued" } }
    try { await updateKit(kit.id, { assets }); onChange({ assets }) } catch { setErr("לא הצלחנו לנסות שוב") }
  }
  const remove = async () => {
    if (!window.confirm("למחוק את הערכה?")) return
    setBusy("delete")
    try { await deleteFeedDraft(kit.id); onGone() } catch { setErr("המחיקה נכשלה"); setBusy(null) }
  }

  const a = kit.assets || {}
  const vertical = a.vertical
  const hasVideo = !!(kit.video_uid || a.horizontal)
  const images = a.images || (kit.image_url ? [kit.image_url] : [])
  const stamp = new Date(kit.created_at).toLocaleDateString("he-IL", { day: "numeric", month: "numeric" })
  const fileBase = `rinkhockeyil-${stamp.replace(/\D+/g, "-")}-${kit.id.slice(0, 6)}`

  return (
    <article className={`card p-4 sm:p-5 space-y-4 ${published ? "opacity-60" : ""}`}>
      <header className="flex items-center gap-2 flex-wrap text-xs">
        <BrandIcon name={type?.icon || "document"} className="w-5 h-5" />
        <span className="font-bold text-sm text-slate-900 dark:text-white">{type?.title || "טיוטה לפיד"}</span>
        <span className={`px-2 py-0.5 rounded-full font-bold ${state.cls}`}>{state.label}</span>
        <span className="text-slate-400">{stamp}</span>
        {game && <Link to={`/games/${game.slug || game.id}`} className="text-slate-500 hover:text-brand">{gameLabel(game)}</Link>}
      </header>

      <div className="grid gap-4 md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] md:items-start">
        <div className="space-y-2">
          {hasVideo && vertical && (
            <div className="flex rounded-full bg-slate-100 dark:bg-slate-800 p-1 text-xs font-semibold w-fit">
              <button onClick={() => setView("h")} className={`inline-flex items-center gap-1 px-3 py-1 rounded-full ${view === "h" ? "bg-white dark:bg-slate-700 shadow-sm" : "text-slate-500"}`}><Monitor className="w-3.5 h-3.5" /> אתר 16:9</button>
              <button onClick={() => setView("v")} className={`inline-flex items-center gap-1 px-3 py-1 rounded-full ${view === "v" ? "bg-white dark:bg-slate-700 shadow-sm" : "text-slate-500"}`}><Smartphone className="w-3.5 h-3.5" /> רשתות 9:16</button>
            </div>
          )}
          {hasVideo && view === "h" && (kit.video_uid
            ? <FeedVideo provider="cloudflare" videoId={kit.video_uid} cfCode={kit.video_cf_code} ratio={kit.video_ratio} poster={streamThumb(kit.video_cf_code, kit.video_uid)} title={firstLine(kit.body)} />
            : <video src={a.horizontal.url} controls playsInline preload="metadata" className="w-full rounded-xl bg-black aspect-video" />)}
          {hasVideo && view === "v" && vertical?.status === "error" && (
            <div className="mx-auto aspect-[9/16] w-48 rounded-xl bg-red-50 dark:bg-red-900/20 flex flex-col items-center justify-center text-center p-4 text-xs text-red-700 dark:text-red-300 gap-2">
              <AlertTriangle className="w-5 h-5" /> הכנת הגרסה האנכית נכשלה
              <button onClick={retryVertical} className="px-3 py-1.5 rounded-full bg-white dark:bg-slate-800 font-semibold text-slate-700 dark:text-slate-200">נסו שוב</button>
            </div>
          )}
          {hasVideo && view === "v" && vertical?.status !== "error" && (vertical?.status === "ready" && vertical.url
            ? <video src={vertical.url} controls playsInline preload="metadata" className="mx-auto max-h-[28rem] aspect-[9/16] rounded-xl bg-black" />
            : <div className="mx-auto max-h-[28rem] aspect-[9/16] w-48 rounded-xl bg-slate-100 dark:bg-slate-800 flex flex-col items-center justify-center text-center p-4 text-xs text-slate-500 gap-2">
                <Loader2 className="w-5 h-5 animate-spin" /> הגרסה האנכית בהכנה — המצלמה תעקוב אחרי הכדור והשער יישאר בתמונה
              </div>)}
          {!hasVideo && images.length > 0 && (
            <div className={`grid gap-1.5 ${images.length > 1 ? "grid-cols-2" : ""}`}>
              {images.slice(0, 4).map((src, i) => <img key={i} src={src} alt="" loading="lazy" className="w-full aspect-square object-cover rounded-lg" />)}
              {images.length > 4 && <p className="col-span-2 text-xs text-slate-500">+ עוד {images.length - 4} תמונות</p>}
            </div>
          )}
          {!hasVideo && !images.length && kit.status !== "queued" && (
            <div className="rounded-xl bg-slate-100 dark:bg-slate-800 aspect-video flex items-center justify-center text-sm text-slate-400">טקסט בלבד</div>
          )}
          {kit.status === "queued" && !hasVideo && (
            <div className="rounded-xl bg-blue-50 dark:bg-blue-900/20 aspect-video flex flex-col items-center justify-center text-center gap-2 p-4 text-sm text-blue-800 dark:text-blue-200">
              <Loader2 className="w-5 h-5 animate-spin" /> הסרטון בתור לעיבוד במחשב הווידאו
            </div>
          )}
          {kit.brief && <p className="text-xs text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800 rounded-lg px-3 py-2"><b>המהלך:</b> {kit.brief}</p>}
          {kit.note && <p className="text-xs text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 rounded-lg px-3 py-2">{kit.note}</p>}
        </div>

        <div className="space-y-3">
          <div className="flex gap-1 overflow-x-auto [scrollbar-width:none]" role="tablist">
            {outputs.map(o => (
              <button key={o} role="tab" aria-selected={tab === o} onClick={() => { saveCaption(); setTab(o) }}
                className={`px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap ${tab === o ? "bg-brand text-white" : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"}`}>
                {OUTPUT_BY_ID[o]?.label || o}
              </button>
            ))}
          </div>

          <textarea value={draft} onChange={e => setDraft(e.target.value.slice(0, 2200))} onBlur={saveCaption} rows={6} disabled={published}
            className="w-full resize-y bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand/30" />

          <div className="flex flex-wrap items-center gap-2">
            {tab === "site" ? (
              published ? <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-600"><Check className="w-4 h-4" /> פורסם באתר</span> : (
                <button onClick={publish} disabled={!!busy || kit.status === "queued" || kit.status === "processing"}
                  title={kit.status === "queued" ? "ממתין לסרטון" : undefined}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-brand text-white text-sm font-bold hover:bg-brand-hover disabled:opacity-40">
                  {busy === "publish" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} פרסום באתר
                </button>
              )
            ) : (
              <>
                <button onClick={copy} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-brand text-white text-sm font-bold hover:bg-brand-hover">
                  {copied === tab ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />} {copied === tab ? "הועתק!" : "העתקת הטקסט"}
                </button>
                {hasVideo && vertical && (vertical.status === "ready" && vertical.url
                  ? <button onClick={() => downloadFile(vertical.url, `${fileBase}-9x16.mp4`)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-sm font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200"><Download className="w-4 h-4" /> סרטון אנכי</button>
                  : <span className="text-xs text-slate-500">הסרטון האנכי יופיע כאן כשיהיה מוכן</span>)}
              </>
            )}
            {hasVideo && a.horizontal?.url && (
              <button onClick={() => downloadFile(a.horizontal.url, `${fileBase}-16x9.mp4`)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-sm font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200">
                <Download className="w-4 h-4" /> סרטון 16:9
              </button>
            )}
            {images.length > 0 && (
              <button onClick={async () => { for (let i = 0; i < images.length; i++) await downloadFile(images[i], `${fileBase}-${i + 1}.jpg`) }}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-sm font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200">
                <Download className="w-4 h-4" /> {images.length > 1 ? `${images.length} תמונות` : "תמונה"}
              </button>
            )}
            <button onClick={remove} disabled={!!busy} aria-label="מחיקת הערכה"
              className="ms-auto inline-flex items-center gap-1 px-3 py-2 rounded-full text-sm font-semibold text-slate-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20">
              {busy === "delete" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} מחיקה
            </button>
          </div>
          {a.more?.length > 0 && (
            <div className="text-xs text-slate-600 dark:text-slate-300 space-y-1">
              <p className="font-semibold">קליפים נוספים בערכה:</p>
              {a.more.map((m, i) => m.url && (
                <button key={i} onClick={() => downloadFile(m.url, `${fileBase}-clip${i + 2}.mp4`)} className="flex items-center gap-1 hover:text-brand"><Download className="w-3.5 h-3.5" /> {m.label}</button>
              ))}
            </div>
          )}
          {err && <p className="text-xs text-red-600 dark:text-red-400 font-medium">{err}</p>}
        </div>
      </div>
    </article>
  )
}
