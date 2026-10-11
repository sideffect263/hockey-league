import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  FlaskConical, RefreshCw, Loader2, Upload, ArrowRight, Play, Pause, ChevronLeft, ChevronRight,
  ChevronsLeft, ChevronsRight, Ban, HelpCircle, Eraser, Goal, Zap, Trash2, Check, Wand2,
} from "lucide-react"
import {
  getLabClips, getLabClip, getLabLabels, saveLabLabel, deleteLabLabel, updateLabClip, uploadLabClip, deleteLabClip, labUrl,
} from "@/lib/videoLab"
import { SkeletonPanelRows } from "@/components/skeletons/PageSkeletons"

// Video lab: review the AI ball tracking frame by frame, fix it, queue a re-render.
// Every fix is a training label for the ball models (video-analysis/ on the Mac).

const STATUS = {
  new:        { label: "ממתין ל-AI",    cls: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300" },
  review:     { label: "לבדיקה",        cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" },
  queued:     { label: "בתור לעיבוד",   cls: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300" },
  processing: { label: "בעיבוד…",       cls: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300" },
  done:       { label: "מעובד",         cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" },
  error:      { label: "שגיאה",         cls: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" },
}
function StatusPill({ status }) {
  const s = STATUS[status] || STATUS.review
  return <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${s.cls}`}>{s.label}</span>
}

export default function VideoLab() {
  const [clips, setClips] = useState(null)
  const [error, setError] = useState(null)
  const [openId, setOpenId] = useState(() => new URLSearchParams(window.location.search).get("clip"))

  const load = useCallback(() => {
    setError(null)
    getLabClips().then(setClips).catch(e => setError(e.message || "שגיאה בטעינה"))
  }, [])
  useEffect(load, [load])

  const open = (id) => {
    setOpenId(id)
    const u = new URL(window.location.href)
    if (id) u.searchParams.set("clip", id); else u.searchParams.delete("clip")
    window.history.replaceState(null, "", u)
  }

  if (openId) return <ClipEditor id={openId} onBack={() => { open(null); load() }} />

  return (
    <div className="space-y-4">
      <div className="card p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <FlaskConical className="w-6 h-6 text-brand shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <h2 className="font-bold text-slate-900 dark:text-white">מעבדת וידאו</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              עוברים על הקליפ פריים אחרי פריים, בודקים איפה ה-AI חושב שהכדור נמצא ומתקנים: לחיצה על הכדור האמיתי, "אין כדור", ורגע הגול.
              כל תיקון משפר את הסרטון הזה ומלמד את המודל לעתיד.
            </p>
          </div>
          <button onClick={load} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500" aria-label="רענון">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      <UploadClip onDone={(c) => { load(); if (c) open(c.id) }} />

      {error ? (
        <div className="card p-6 text-center text-sm text-red-600">
          {error} <button onClick={load} className="underline ms-2">נסו שוב</button>
        </div>
      ) : clips === null ? (
        <SkeletonPanelRows count={4} height="h-24" />
      ) : clips.length === 0 ? (
        <div className="card p-8 text-center text-sm text-slate-500">אין עדיין קליפים במעבדה.</div>
      ) : (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {clips.map(c => (
            <button key={c.id} onClick={() => open(c.id)}
              className="card overflow-hidden text-start hover:ring-2 hover:ring-brand/40 transition">
              <div className="aspect-video bg-slate-900">
                <video src={`${labUrl(c.processed_path || c.source_path)}#t=1`} preload="metadata" muted playsInline className="w-full h-full object-cover pointer-events-none" />
              </div>
              <div className="p-3 space-y-1.5">
                <div className="flex items-start gap-2">
                  <span className="font-semibold text-sm text-slate-900 dark:text-white flex-1 min-w-0 line-clamp-2">{c.title}</span>
                  <StatusPill status={c.status} />
                </div>
                {c.worker_note && <p className="text-xs text-slate-500 line-clamp-2">{c.worker_note}</p>}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function UploadClip({ onDone }) {
  const [file, setFile] = useState(null)
  const [title, setTitle] = useState("")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const inputRef = useRef(null)
  const submit = async () => {
    if (!file) return
    if (file.size > 50 * 1024 * 1024) { setErr("הקובץ גדול מ-50MB — קצרו את הקליפ"); return }
    setBusy(true); setErr(null)
    try {
      const c = await uploadLabClip(file, title)
      setFile(null); setTitle(""); if (inputRef.current) inputRef.current.value = ""
      onDone?.(c)
    } catch (e) { setErr(e.message || "ההעלאה נכשלה") } finally { setBusy(false) }
  }
  return (
    <div className="card p-4 flex flex-wrap items-center gap-2">
      <Upload className="w-4 h-4 text-slate-400" />
      <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">העלאת קליפ חדש</span>
      <input ref={inputRef} type="file" accept="video/mp4,video/quicktime,video/webm" onChange={e => setFile(e.target.files?.[0] || null)}
        className="text-sm file:me-2 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-slate-100 dark:file:bg-slate-800 file:text-sm" />
      {file && <input value={title} onChange={e => setTitle(e.target.value)} placeholder="כותרת (למשל: גול של…)" className="filter-input flex-1 min-w-[10rem]" />}
      {file && (
        <button onClick={submit} disabled={busy} className="px-3 py-1.5 rounded-lg bg-brand text-white text-sm font-semibold hover:bg-brand-hover disabled:opacity-60 flex items-center gap-1.5">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} העלאה
        </button>
      )}
      {err && <span className="text-xs text-red-600 w-full">{err}</span>}
      <span className="text-xs text-slate-400 w-full">עד 50MB. אחרי ההעלאה ה-AI מנתח את הקליפ (על המחשב של הליגה) והוא יופיע לבדיקה.</span>
    </div>
  )
}

const KIND_COLOR = { det: "#facc15", human: "#facc15", streak: "#22d3ee", interp: "#a78bfa", bridge: "#a78bfa", shot: "#fb923c" }
const KIND_NAME = { det: "זיהוי", streak: "תנועה מהירה", interp: "השלמה", bridge: "גישור", shot: "קו בעיטה", human: "אנושי" }
const LABEL_COLOR = { ball: "#22c55e", none: "#ef4444", unsure: "#94a3b8" }

function ClipEditor({ id, onBack }) {
  const [clip, setClip] = useState(null)
  const [labels, setLabels] = useState(() => new Map())
  const [err, setErr] = useState(null)
  const [frame, setFrame] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [mode, setMode] = useState("source")            // source (+ overlays) | processed
  const [autoAdvance, setAutoAdvance] = useState(true)
  const [saving, setSaving] = useState(0)
  const [saveErr, setSaveErr] = useState(null)
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const timelineRef = useRef(null)
  const boxRef = useRef(null)

  useEffect(() => {
    let alive = true
    Promise.all([getLabClip(id), getLabLabels(id)])
      .then(([c, ls]) => { if (!alive) return; setClip(c); setLabels(new Map(ls.map(l => [l.frame, l]))) })
      .catch(e => alive && setErr(e.message || "שגיאה בטעינה"))
    return () => { alive = false }
  }, [id])

  const fps = clip?.fps || 30
  const track = Array.isArray(clip?.track) ? clip.track : []
  const nFrames = clip?.n_frames || track.length || 1

  // ---- frame <-> time ----------------------------------------------------------------------
  const seek = useCallback((f) => {
    const v = videoRef.current; if (!v) return
    const ff = Math.max(0, Math.min(nFrames - 1, f))
    v.pause(); setPlaying(false); setFrame(ff)
    v.currentTime = (ff + 0.5) / fps
  }, [fps, nFrames])

  useEffect(() => {                                     // follow playback frame-accurately where supported
    const v = videoRef.current; if (!v || !playing) return
    let handle, raf
    if (v.requestVideoFrameCallback) {
      const cb = (_n, meta) => { setFrame(Math.min(nFrames - 1, Math.floor(meta.mediaTime * fps + 0.01))); handle = v.requestVideoFrameCallback(cb) }
      handle = v.requestVideoFrameCallback(cb)
      return () => v.cancelVideoFrameCallback?.(handle)
    }
    const tick = () => { setFrame(Math.min(nFrames - 1, Math.floor(v.currentTime * fps))); raf = requestAnimationFrame(tick) }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, fps, nFrames])

  const togglePlay = () => {
    const v = videoRef.current; if (!v) return
    if (v.paused) { v.play(); setPlaying(true) } else { v.pause(); setPlaying(false); seek(Math.floor(v.currentTime * fps)) }
  }

  // ---- labels ------------------------------------------------------------------------------
  const persist = useCallback(async (f, label) => {
    setSaving(n => n + 1); setSaveErr(null)
    try {
      if (label) await saveLabLabel(id, f, label.kind, label.x ?? null, label.y ?? null)
      else await deleteLabLabel(id, f)
    } catch (e) { setSaveErr(e.message || "השמירה נכשלה") } finally { setSaving(n => n - 1) }
  }, [id])

  const setLabel = useCallback((f, label, advance = autoAdvance) => {
    setLabels(prev => { const m = new Map(prev); if (label) m.set(f, { frame: f, ...label }); else m.delete(f); return m })
    persist(f, label)
    if (advance && f < nFrames - 1) seek(f + 1)
  }, [persist, autoAdvance, nFrames, seek])

  // frames that still need a person: the AI had no clean detection there and nobody labelled it yet
  const needsLook = useCallback((f) => !labels.has(f) && !(track[f] && track[f][3] === "det"), [labels, track])
  const nextToCheck = () => {
    for (let f = frame + 1; f < nFrames; f++) if (needsLook(f)) return seek(f)
    for (let f = 0; f <= frame; f++) if (needsLook(f)) return seek(f)
  }

  const acceptAI = () => {
    const p = track[frame]; if (!p) return
    setLabel(frame, { kind: "ball", x: p[0], y: p[1] })
  }

  const setClipField = async (patch) => {
    setClip(c => ({ ...c, ...patch }))
    try { await updateLabClip(id, patch) } catch (e) { setSaveErr(e.message || "השמירה נכשלה") }
  }

  // ---- drawing -----------------------------------------------------------------------------
  const draw = useCallback(() => {
    const cv = canvasRef.current, box = boxRef.current; if (!cv || !box) return
    const W = box.clientWidth, H = box.clientHeight, dpr = window.devicePixelRatio || 1
    if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr) }
    const ctx = cv.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H)
    if (mode !== "source") return
    // AI trail (last 8 frames) + current AI point
    ctx.lineWidth = 2
    for (let k = Math.max(1, frame - 8); k <= frame; k++) {
      const a = track[k - 1], b = track[k]
      if (!a || !b) continue
      ctx.strokeStyle = `rgba(250,204,21,${0.15 + 0.6 * (k - frame + 8) / 8})`
      ctx.beginPath(); ctx.moveTo(a[0] * W, a[1] * H); ctx.lineTo(b[0] * W, b[1] * H); ctx.stroke()
    }
    const p = track[frame]
    if (p) {
      const r = Math.max(10, p[2] * W * 2.2)
      ctx.strokeStyle = KIND_COLOR[p[3]] || "#facc15"; ctx.lineWidth = 2; ctx.setLineDash(p[3] === "det" ? [] : [5, 4])
      ctx.beginPath(); ctx.arc(p[0] * W, p[1] * H, r, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([])
    }
    const l = labels.get(frame)
    if (l?.kind === "ball") {
      ctx.strokeStyle = LABEL_COLOR.ball; ctx.lineWidth = 2.5
      const x = l.x * W, y = l.y * H
      ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(x - 14, y); ctx.lineTo(x - 9, y); ctx.moveTo(x + 9, y); ctx.lineTo(x + 14, y)
      ctx.moveTo(x, y - 14); ctx.lineTo(x, y - 9); ctx.moveTo(x, y + 9); ctx.lineTo(x, y + 14); ctx.stroke()
    } else if (l) {
      ctx.fillStyle = l.kind === "none" ? "rgba(239,68,68,.85)" : "rgba(100,116,139,.85)"
      ctx.fillRect(8, 8, 92, 26); ctx.fillStyle = "#fff"; ctx.font = "bold 14px system-ui"; ctx.textAlign = "center"
      ctx.fillText(l.kind === "none" ? "אין כדור" : "לא בטוח", 54, 26)
    }
  }, [frame, labels, mode, track])
  useEffect(draw, [draw])
  useEffect(() => {
    const box = boxRef.current; if (!box) return
    const ro = new ResizeObserver(() => { draw(); drawTimeline() }); ro.observe(box)
    return () => ro.disconnect()
  })

  const drawTimeline = useCallback(() => {
    const cv = timelineRef.current; if (!cv || !clip) return
    const W = cv.clientWidth, H = 40, dpr = window.devicePixelRatio || 1
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr)
    const ctx = cv.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = "rgba(100,116,139,.15)"; ctx.fillRect(0, 0, W, H)
    const cw = W / nFrames
    for (let f = 0; f < nFrames; f++) {
      const p = track[f]
      if (p) { ctx.fillStyle = KIND_COLOR[p[3]] || "#facc15"; ctx.fillRect(f * cw, 2, Math.max(1, cw), 16) }
      const l = labels.get(f)
      if (l) { ctx.fillStyle = LABEL_COLOR[l.kind]; ctx.fillRect(f * cw, 22, Math.max(1, cw), 16) }
    }
    const mark = (f, col) => { if (f == null) return; ctx.fillStyle = col; ctx.fillRect(f * cw - 1, 0, 3, H) }
    mark(clip.strike_frame, "#fb923c"); mark(clip.goal_frame, "#ef4444")
    ctx.fillStyle = "#3b4fc4"; ctx.fillRect(frame * cw - 1, 0, 2, H)
  }, [clip, frame, labels, nFrames, track])
  useEffect(drawTimeline, [drawTimeline])

  const onTimeline = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    seek(Math.floor((e.clientX - r.left) / r.width * nFrames))
  }

  const onCanvasClick = (e) => {
    if (mode !== "source") return
    const r = e.currentTarget.getBoundingClientRect()
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height
    if (x < 0 || x > 1 || y < 0 || y > 1) return
    if (playing) togglePlay()
    setLabel(frame, { kind: "ball", x: +x.toFixed(5), y: +y.toFixed(5) })
  }

  // ---- keyboard ----------------------------------------------------------------------------
  useEffect(() => {
    const onKey = (e) => {
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName)) return
      const k = e.key.toLowerCase()
      if (e.key === "ArrowRight") { e.preventDefault(); seek(frame + (e.shiftKey ? 10 : 1)) }
      else if (e.key === "ArrowLeft") { e.preventDefault(); seek(frame - (e.shiftKey ? 10 : 1)) }
      else if (e.key === " ") { e.preventDefault(); togglePlay() }
      else if (k === "n" || k === "מ") setLabel(frame, { kind: "none" })
      else if (k === "u" || k === "ו") setLabel(frame, { kind: "unsure" })
      else if (k === "a" || k === "ש") acceptAI()
      else if (e.key === "Delete" || e.key === "Backspace") setLabel(frame, null, false)
      else if (k === "g" || k === "ע") setClipField({ goal_frame: frame })
      else if (k === "s" || k === "ד") setClipField({ strike_frame: frame })
      else if (k === "j" || k === "ח") nextToCheck()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  const stats = useMemo(() => {
    let ball = 0, none = 0, unsure = 0
    labels.forEach(l => { if (l.kind === "ball") ball++; else if (l.kind === "none") none++; else unsure++ })
    let todo = 0
    for (let f = 0; f < nFrames; f++) if (!labels.has(f) && !(track[f] && track[f][3] === "det")) todo++
    return { ball, none, unsure, ai: track.filter(Boolean).length, todo }
  }, [labels, track, nFrames])

  if (err) return <div className="card p-6 text-center text-sm text-red-600">{err} <button onClick={onBack} className="underline ms-2">חזרה</button></div>
  if (!clip) return <SkeletonPanelRows count={3} height="h-40" />

  const ratio = clip.width && clip.height ? `${clip.width} / ${clip.height}` : "16 / 9"
  const cur = track[frame]
  const lab = labels.get(frame)
  const src = mode === "processed" && clip.processed_path ? labUrl(clip.processed_path) : labUrl(clip.source_path)
  const btn = "p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 disabled:opacity-40"
  const act = "px-3 py-1.5 rounded-lg text-sm font-semibold flex items-center gap-1.5 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={onBack} className={btn} aria-label="חזרה לרשימה"><ArrowRight className="w-5 h-5" /></button>
        <h2 className="font-bold text-slate-900 dark:text-white flex-1 min-w-0 truncate">{clip.title}</h2>
        <StatusPill status={clip.status} />
        {saving > 0 ? <Loader2 className="w-4 h-4 animate-spin text-slate-400" /> : <Check className="w-4 h-4 text-emerald-500" aria-label="נשמר" />}
      </div>
      {saveErr && <div className="text-xs text-red-600">{saveErr}</div>}
      {clip.status === "new" && <div className="card p-3 text-sm text-slate-600 dark:text-slate-300">הקליפ ממתין לניתוח ה-AI. אפשר כבר לתייג, הסימון של ה-AI יופיע כשהניתוח יסתיים.</div>}

      <div className="card p-3 flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">סוג הקליפ:</span>
        <div className="flex rounded-xl bg-slate-100 dark:bg-slate-800 p-1 text-sm">
          <button onClick={() => setClipField({ no_replay: false })}
            className={`px-3 py-1.5 rounded-lg font-semibold flex items-center gap-1.5 ${!clip.no_replay ? "bg-white dark:bg-slate-700 shadow text-brand" : "text-slate-500"}`}>
            <Goal className="w-4 h-4" /> גול — עם הילוך חוזר
          </button>
          <button onClick={() => setClipField({ no_replay: true })}
            className={`px-3 py-1.5 rounded-lg font-semibold ${clip.no_replay ? "bg-white dark:bg-slate-700 shadow text-brand" : "text-slate-500"}`}>
            לא גול (מהלך, לחיצות ידיים…)
          </button>
        </div>
        {!clip.no_replay && (clip.goal_frame == null
          ? <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">חסר: סמנו את רגע הגול — עמדו על הפריים שהכדור נכנס ולחצו "רגע הגול כאן" (G)</span>
          : <button className="text-xs underline text-slate-500" onClick={() => seek(clip.goal_frame)}>רגע הגול: פריים #{clip.goal_frame}</button>)}
      </div>

      <div className="flex gap-1 text-sm">
        <button onClick={() => setMode("source")} className={`px-3 py-1.5 rounded-lg font-semibold ${mode === "source" ? "bg-brand text-white" : "bg-slate-100 dark:bg-slate-800"}`}>מקור + סימון AI</button>
        <button onClick={() => setMode("processed")} disabled={!clip.processed_path}
          className={`px-3 py-1.5 rounded-lg font-semibold disabled:opacity-40 ${mode === "processed" ? "bg-brand text-white" : "bg-slate-100 dark:bg-slate-800"}`}>הסרטון המעובד</button>
      </div>

      {mode === "processed" ? (
        <video key={src} src={src} controls playsInline className="w-full rounded-xl bg-black" />
      ) : (
        <>
          <div ref={boxRef} className="relative w-full rounded-xl overflow-hidden bg-black select-none" style={{ aspectRatio: ratio }}>
            <video key={src} ref={videoRef} src={src} playsInline muted preload="auto" className="absolute inset-0 w-full h-full"
              onLoadedMetadata={() => seek(0)} onEnded={() => setPlaying(false)} />
            <canvas ref={canvasRef} onClick={onCanvasClick} className="absolute inset-0 w-full h-full cursor-crosshair" />
          </div>

          <div dir="ltr" className="space-y-1">
            <canvas ref={timelineRef} onClick={onTimeline} className="w-full h-10 rounded-md cursor-pointer" />
            <div className="flex items-center gap-1 flex-wrap">
              <button className={btn} onClick={() => seek(frame - 10)} aria-label="10 פריימים אחורה"><ChevronsLeft className="w-5 h-5" /></button>
              <button className={btn} onClick={() => seek(frame - 1)} aria-label="פריים אחורה"><ChevronLeft className="w-5 h-5" /></button>
              <button className={btn} onClick={togglePlay} aria-label={playing ? "עצירה" : "ניגון"}>{playing ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}</button>
              <button className={btn} onClick={() => seek(frame + 1)} aria-label="פריים קדימה"><ChevronRight className="w-5 h-5" /></button>
              <button className={btn} onClick={() => seek(frame + 10)} aria-label="10 פריימים קדימה"><ChevronsRight className="w-5 h-5" /></button>
              <span className="text-xs tabular-nums text-slate-500 ms-2">#{frame} / {nFrames - 1} · {(frame / fps).toFixed(2)}s</span>
              <span className="text-xs text-slate-500 ms-auto" dir="rtl">
                AI: {cur ? <b style={{ color: KIND_COLOR[cur[3]] }}>{KIND_NAME[cur[3]] || cur[3]}</b> : "אין סימון"}
                {lab && <> · שלך: <b style={{ color: LABEL_COLOR[lab.kind] }}>{lab.kind === "ball" ? "כדור" : lab.kind === "none" ? "אין כדור" : "לא בטוח"}</b></>}
              </span>
            </div>
          </div>

          <div className="card p-3 space-y-3">
            <div className="flex flex-wrap gap-2">
              <span className="text-sm text-slate-600 dark:text-slate-300 w-full">לחיצה על הכדור בתמונה = "הכדור כאן". או:</span>
              <button className={`${act} border-brand/40 text-brand`} onClick={nextToCheck} disabled={stats.todo === 0} title="J">
                <ChevronsLeft className="w-4 h-4" /> הפריים הבא לבדיקה ({stats.todo}) <kbd className="text-[10px] opacity-60">J</kbd>
              </button>
              <button className={act} onClick={acceptAI} disabled={!cur} title="A"><Check className="w-4 h-4 text-emerald-600" /> ה-AI צודק <kbd className="text-[10px] opacity-60">A</kbd></button>
              <button className={act} onClick={() => setLabel(frame, { kind: "none" })} title="N"><Ban className="w-4 h-4 text-red-500" /> אין כדור / מוסתר <kbd className="text-[10px] opacity-60">N</kbd></button>
              <button className={act} onClick={() => setLabel(frame, { kind: "unsure" })} title="U"><HelpCircle className="w-4 h-4 text-slate-500" /> לא בטוח <kbd className="text-[10px] opacity-60">U</kbd></button>
              <button className={act} onClick={() => setLabel(frame, null, false)} disabled={!lab}><Eraser className="w-4 h-4" /> מחיקת תיוג</button>
              <label className="flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-300 ms-auto">
                <input type="checkbox" checked={autoAdvance} onChange={e => setAutoAdvance(e.target.checked)} /> התקדם לפריים הבא אחרי תיוג
              </label>
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              <button className={act} onClick={() => setClipField({ strike_frame: frame })}><Zap className="w-4 h-4 text-orange-500" /> רגע הבעיטה כאן <kbd className="text-[10px] opacity-60">S</kbd></button>
              <button className={act} onClick={() => setClipField({ goal_frame: frame })}><Goal className="w-4 h-4 text-red-500" /> רגע הגול כאן <kbd className="text-[10px] opacity-60">G</kbd></button>
              {clip.strike_frame != null && <button className="text-xs underline text-slate-500" onClick={() => seek(clip.strike_frame)}>בעיטה: #{clip.strike_frame}</button>}
              {clip.goal_frame != null && <button className="text-xs underline text-slate-500" onClick={() => seek(clip.goal_frame)}>גול: #{clip.goal_frame}</button>}
            </div>
            <Legend />
            <p className="text-[11px] text-slate-400">מקשים: ←/→ פריים, Shift+חץ 10 פריימים, רווח ניגון, Delete מחיקה, J הפריים הבא שה-AI לא בטוח בו.</p>
          </div>
        </>
      )}

      <div className="card p-3 flex flex-wrap items-center gap-3">
        <span className="text-sm text-slate-600 dark:text-slate-300">
          תויגו: <b>{stats.ball}</b> כדור · <b>{stats.none}</b> אין כדור · <b>{stats.unsure}</b> לא בטוח · ה-AI סימן {stats.ai} מתוך {nFrames} פריימים
        </span>
        <div className="ms-auto flex gap-2">
          {!clip.no_replay && clip.goal_frame == null && <span className="text-xs text-amber-700 dark:text-amber-400 self-center">קודם סמנו את רגע הגול (G)</span>}
          <button onClick={() => setClipField({ status: "queued", worker_note: null })}
            disabled={clip.status === "queued" || clip.status === "processing" || (!clip.no_replay && clip.goal_frame == null)}
            className="px-3 py-1.5 rounded-lg bg-brand text-white text-sm font-semibold hover:bg-brand-hover disabled:opacity-50 flex items-center gap-1.5">
            <Wand2 className="w-4 h-4" /> {clip.status === "queued" ? "בתור לעיבוד" : "עבד מחדש עם התיקונים"}
          </button>
          <DeleteClip clip={clip} onDone={onBack} />
        </div>
        {clip.worker_note && <p className="text-xs text-slate-500 w-full">{clip.worker_note}</p>}
        <textarea defaultValue={clip.note || ""} onBlur={e => e.target.value !== (clip.note || "") && setClipField({ note: e.target.value || null })}
          placeholder="הערות (למשל: הכדור נכנס בפינה הימנית, השוער מסתיר)" rows={2} maxLength={1000} className="filter-input w-full text-sm" />
      </div>
    </div>
  )
}

function Legend() {
  const item = (c, t, dashed) => (
    <span className="flex items-center gap-1.5">
      <span className="w-3 h-3 rounded-full border-2" style={{ borderColor: c, borderStyle: dashed ? "dashed" : "solid" }} />{t}
    </span>
  )
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
      {item(KIND_COLOR.det, "AI: זיהוי")}
      {item(KIND_COLOR.streak, "AI: תנועה מהירה", true)}
      {item(KIND_COLOR.interp, "AI: השלמה בין זיהויים", true)}
      {item(KIND_COLOR.shot, "AI: קו הבעיטה", true)}
      {item(LABEL_COLOR.ball, "התיוג שלך")}
      <span className="flex items-center gap-1.5"><span className="w-3 h-1.5" style={{ background: LABEL_COLOR.none }} />אין כדור</span>
    </div>
  )
}

function DeleteClip({ clip, onDone }) {
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  if (!confirm) return <button onClick={() => setConfirm(true)} className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40" aria-label="מחיקת קליפ"><Trash2 className="w-4 h-4" /></button>
  return (
    <span className="flex items-center gap-1 text-sm">
      למחוק?
      <button disabled={busy} onClick={async () => { setBusy(true); try { await deleteLabClip(clip); onDone() } finally { setBusy(false) } }} className="px-2 py-1 rounded bg-red-600 text-white">כן</button>
      <button onClick={() => setConfirm(false)} className="px-2 py-1 rounded bg-slate-100 dark:bg-slate-800">לא</button>
    </span>
  )
}
