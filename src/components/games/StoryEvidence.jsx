import { useState } from "react"
import { Play, Table2, Image as ImageIcon } from "lucide-react"
import { ClipboardIcon as ClipboardList, Film as Video, EditIcon as PenLine, Checklist as ListChecks, Approved as ShieldCheck, Help as ShieldQuestion, PlayBadge, GameForm, Table } from "@/components/icons/BrandIcons"
import { streamIframeUrl, streamThumbUrl } from "@/lib/gameStories"

/*
 * Shared pieces of the evidence-backed game timeline: the beat's evidence (a lazy Stream
 * player / a photo / source chips), its header (period · clock · score) and the verified badge.
 * Used by the public story (GameStory) and the editors' review (GameStoriesReview).
 */

export const periodLabel = (p) => {
  if (p == null || p === "") return null
  const s = String(p)
  return /^\d+$/.test(s) ? `מחצית ${s}` : s
}

const clockText = (ms) => {
  if (ms == null) return null
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

const EVENT_KIND = {
  goal: "שער", blue: "כרטיס כחול", red: "כרטיס אדום", foul: "עבירה", timeout: "פסק זמן",
  break: "הפסקה", period_start: "פתיחת מחצית", period_end: "סיום מחצית", save: "הצלה",
  chance: "הזדמנות", celebration: "חגיגה", lineup: "הרכב", handshake: "לחיצת ידיים", moment: "רגע",
}

const SOURCE = {
  judge: { label: "מקור: לוח השיפוט", icon: ClipboardList },
  form: { label: "מקור: טופס השיפוט", icon: GameForm },
  video: { label: "מקור: וידאו", icon: Video },
  editor: { label: "מקור: עורך", icon: PenLine },
  box: { label: "תוצאות המשחק", icon: ListChecks },
}

const STAT = {
  box_score: { label: "תוצאות המשחק", icon: ListChecks },
  table: { label: "טבלת הליגה", icon: Table },
  standings: { label: "טבלת הליגה", icon: Table },
  form: { label: "טופס השיפוט", icon: GameForm },
  season: { label: "נתוני העונה", icon: Table },
  h2h: { label: "מפגשים קודמים", icon: Table },
  player_stats: { label: "סטטיסטיקת שחקנים", icon: ListChecks },
}

/** "מחצית 1 · 12:31" + the score after, away:home in an LTR run. */
export function BeatHeader({ beat, homeColor, awayColor }) {
  const parts = [periodLabel(beat.period), beat.game_time].filter(Boolean)
  const sc = beat.score_after
  const hasScore = sc && sc.home != null && sc.away != null
  if (!parts.length && !hasScore) return null
  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold text-fg-muted">
      {parts.length > 0 && (
        <span className="inline-flex items-center gap-1">
          {periodLabel(beat.period)}
          {beat.game_time && <><span aria-hidden="true">·</span><span dir="ltr" className="tabular-nums">{beat.game_time}</span></>}
        </span>
      )}
      {hasScore && (
        <span dir="ltr" className="inline-flex items-center gap-1 rounded-md bg-surface-sunken px-1.5 py-0.5 tabular-nums text-fg-strong" aria-label={`תוצאה: ${sc.home} בית, ${sc.away} חוץ`}>
          <span style={awayColor ? { color: beat.side === "away" ? awayColor : undefined } : undefined}>{sc.away}</span>
          :
          <span style={homeColor ? { color: beat.side === "home" ? homeColor : undefined } : undefined}>{sc.home}</span>
        </span>
      )}
    </div>
  )
}

export function VerifiedBadge({ verified }) {
  return verified ? (
    <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
      <ShieldCheck className="w-4 h-4" /> מאומת
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
      <ShieldQuestion className="w-4 h-4" /> לא מאומת
    </span>
  )
}

function Chip({ icon: Icon, children }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-line bg-surface-sunken/70 px-2 py-0.5 text-[11px] font-semibold text-fg-muted">
      {Icon && <Icon className="w-3 h-3 shrink-0" aria-hidden="true" />}{children}
    </span>
  )
}

/** Source chips: where the beat's events came from + the stats it rests on. */
export function EvidenceChips({ beat, events = {}, detailed = false }) {
  const chips = []
  const seen = new Set()
  const add = (key, node) => { if (!seen.has(key)) { seen.add(key); chips.push(node) } }
  for (const id of beat.event_ids || []) {
    const e = events[id]
    if (!e) continue
    if (detailed) {
      const label = [EVENT_KIND[e.kind] || e.kind, e.own_goal ? "(עצמי)" : null, e.player_name, periodLabel(e.period), clockText(e.clock_ms)].filter(Boolean).join(" · ")
      add(`ev:${id}`, <Chip key={`ev:${id}`} icon={(SOURCE[e.source] || SOURCE.editor).icon}>{label}{e.status !== "confirmed" ? ` (${e.status === "candidate" ? "מועמד" : "נדחה"})` : ""}</Chip>)
    } else {
      const s = SOURCE[e.source]
      if (s) add(`src:${e.source}`, <Chip key={`src:${e.source}`} icon={s.icon}>{s.label}</Chip>)
    }
  }
  for (const st of beat.stats || []) {
    const s = STAT[st] || { label: st, icon: ListChecks }
    add(`st:${s.label}`, <Chip key={`st:${st}`} icon={s.icon}>{s.label}</Chip>)
  }
  if (!chips.length && (beat.event_ids || []).length) add("events", <Chip key="events" icon={ListChecks}>אירועי המשחק</Chip>)
  if (!chips.length) return null
  return <div className="flex flex-wrap gap-1.5">{chips}</div>
}

/** One cited media item: a thumbnail-first Stream player, or a photo. */
export function EvidenceMedia({ cite, row, compact = false }) {
  const [playing, setPlaying] = useState(false)
  const [thumbFallback, setThumbFallback] = useState(0) // 0 = at the cited second, 1 = first frame, 2 = none
  if (!row) return null
  const caption = cite.caption || null
  if (row.kind === "image") {
    if (!row.src) return null
    return (
      <figure className="space-y-1">
        <img src={row.src} alt={caption || "תמונה מהמשחק"} loading="lazy"
          className={`w-full ${compact ? "max-h-40" : "max-h-[420px]"} object-cover rounded-lg bg-surface-sunken border border-line`} />
        {caption && <figcaption className="text-[11px] text-fg-muted">{caption}</figcaption>}
      </figure>
    )
  }
  const start = cite.start_s ?? cite.at_s ?? row.clip_start_s ?? 0
  const iframe = streamIframeUrl(row, start)
  if (!iframe) return null
  // A cited second past the end of the clip makes Stream 404 the still — fall back to frame 0.
  const thumb = thumbFallback === 2 ? null : streamThumbUrl(row, thumbFallback ? 0 : (cite.at_s ?? start))
  return (
    <figure className="space-y-1">
      <div className="relative w-full aspect-video overflow-hidden rounded-lg bg-black border border-line">
        {playing ? (
          <iframe src={iframe} title={caption || "וידאו מהמשחק"} loading="lazy"
            allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture" allowFullScreen
            className="absolute inset-0 w-full h-full border-0" />
        ) : (
          <button type="button" onClick={() => setPlaying(true)} className="group absolute inset-0 w-full h-full"
            aria-label={caption ? `ניגון: ${caption}` : "ניגון הקטע"}>
            {thumb && <img src={thumb} alt="" loading="lazy" onError={() => setThumbFallback(f => f + 1)} className="absolute inset-0 w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-opacity" />}
            <span className="absolute inset-0 flex items-center justify-center">
              <PlayBadge className="size-12 drop-shadow group-hover:scale-105 transition-transform" />
            </span>
            {start > 0 && (
              <span dir="ltr" className="absolute bottom-2 left-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-bold text-white tabular-nums">
                {Math.floor(start / 60)}:{String(Math.floor(start % 60)).padStart(2, "0")}
              </span>
            )}
          </button>
        )}
      </div>
      {caption && <figcaption className="text-[11px] text-fg-muted">{caption}</figcaption>}
    </figure>
  )
}

/** All of a beat's evidence: its media (when the viewer may see it), else its source chips. */
export function BeatEvidence({ beat, media = {}, events = {}, detailed = false, compact = false }) {
  const cites = (beat.media || []).filter(c => media[c.media_id])
  const missing = (beat.media || []).length - cites.length
  return (
    <div className="space-y-2">
      {cites.length > 0 && (
        <div className={`grid gap-2 ${cites.length > 1 && !compact ? "sm:grid-cols-2" : ""}`}>
          {cites.map((c, i) => <EvidenceMedia key={`${c.media_id}:${i}`} cite={c} row={media[c.media_id]} compact={compact} />)}
        </div>
      )}
      {(detailed || cites.length === 0) && <EvidenceChips beat={beat} events={events} detailed={detailed} />}
      {detailed && missing > 0 && (
        <p className="inline-flex items-center gap-1 text-[11px] text-fg-subtle"><ImageIcon className="w-3 h-3" /> {missing} פריטי מדיה לא נמצאו</p>
      )}
    </div>
  )
}
