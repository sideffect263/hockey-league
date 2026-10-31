import { useState, useEffect, useCallback } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { createPortal } from "react-dom"
import { motion } from "framer-motion"
import { format } from "date-fns"
import { Camera, Check, ExternalLink, RefreshCw, Send, Images, UserSearch, Play, ChevronRight, ChevronLeft, X } from "lucide-react"
import { Help as HelpCircle, CalendarDays, Film, Live as Radio, BrandTile, BrandIcon, TestGame } from "@/components/icons/BrandIcons"
import { FLScore } from "@/components/fl/Floodlight"
import { Camera as CameraIcon } from "@/components/icons/HockeyIcons"
import { getMediaClusters, getSuggestionSummary, submitSuggestion, getResolvedCount, getPhotoIndex } from "@/lib/media"
import { getAllGameVideos, videoThumb } from "@/lib/video"
import { getTeams } from "@/lib/api"
import { entityPath } from "@/lib/slugs"
import TeamLogo from "@/components/TeamLogo"
import { useAuth } from "@/lib/AuthContext"
import { MediaClustersSkeleton } from "@/components/skeletons/PageSkeletons"
import { ilDate } from "@/lib/ilTime"

const PAGE = 24

// Core crowd cluster-naming experience (header + info + grid), WITHOUT the
// standalone-page padding — so it renders both as the /media page (wrapped by
// Media below) and embedded inside the content-editors' "מדיה" tab.
export function MediaClusters({ showTitle = true }) {
  const [clusters, setClusters] = useState([])
  const [summary, setSummary] = useState({})
  const [resolved, setResolved] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [visible, setVisible] = useState(PAGE)

  const load = useCallback(async () => {
    try {
      setLoading(true); setError(null)
      const [cl, sum, res] = await Promise.all([
        getMediaClusters({ status: "unresolved" }),
        getSuggestionSummary(),
        getResolvedCount(),
      ])
      setClusters(cl); setSummary(sum); setResolved(res)
    } catch (err) { console.error(err); setError("שגיאה בטעינת המדיה") }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const bumpSummary = (key, name) => setSummary(s => {
    const cur = s[key] || { suggestion_count: 0, top_name: name }
    return { ...s, [key]: { ...cur, suggestion_count: cur.suggestion_count + 1 } }
  })

  if (loading) return <MediaClustersSkeleton />
  if (error) {
    return (
      <div className="fl-card p-6 flex flex-col items-center gap-3 min-h-[240px] justify-center text-center">
        <span className="text-neg text-sm font-semibold">{error}</span>
        <button onClick={load} className="btn-primary min-h-[44px]">
          <RefreshCw className="w-4 h-4" /> נסה שוב
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {showTitle && (
        <h1 className="text-[28px] font-extrabold text-fg-strong flex items-center gap-2.5">
          <BrandTile name="tag" className="w-10 h-10" /> מדיה — זיהוי שחקנים
        </h1>
      )}
      <div className="px-1 space-y-1">
        <p className="text-[13.5px] text-fg-soft leading-relaxed">
          מזהים מי זה? כותבים את השם. כשכמה אנשים מסכימים, השחקן מתויג בכל התמונות שלו.
          אספנו תמונות מהמשחקים וקיבצנו כל שחקן לפי הפנים שלו.
        </p>
        <p className="text-[12.5px] text-fg-muted">
          <span className="fl-num">{clusters.length}</span> שחקנים עדיין לא זוהו · <span className="fl-num">{resolved}</span> כבר זוהו
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {clusters.slice(0, visible).map((c, i) => (
          <ClusterCard
            key={c.cluster_key}
            cluster={c}
            index={i}
            summary={summary[c.cluster_key]}
            onSubmitted={(name) => bumpSummary(c.cluster_key, name)}
          />
        ))}
      </div>

      {visible < clusters.length && (
        <div className="flex justify-center pt-2">
          <button onClick={() => setVisible(v => v + PAGE)}
            className="btn-secondary min-h-[48px] px-6">
            הצג עוד (<span className="fl-num">{clusters.length - visible}</span>)
          </button>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// /media — the league's media: game videos + photo albums (main tab), and the crowd
// player-identification grid (second tab, ?tab=identify). The identify core stays a
// named export because /creators embeds it too.
// ============================================================================
const TABS = [
  { id: "library", label: "וידאו ותמונות", icon: Film },
  { id: "identify", label: "זיהוי שחקנים", icon: UserSearch },
]

export default function Media() {
  const [params, setParams] = useSearchParams()
  const tab = params.get("tab") === "identify" ? "identify" : "library"
  const setTab = (id) => setParams(id === "library" ? {} : { tab: id }, { replace: true })

  return (
    <div className="px-3 sm:px-6 pt-4 sm:pt-6 pb-8 max-w-6xl mx-auto space-y-4">
      <header className="flex items-center gap-2.5 px-1">
        <BrandIcon name="highlights" variant="large" className="w-11 h-11" />
        <div className="flex flex-col gap-0.5">
          <h1 className="text-[28px] font-extrabold leading-tight text-fg-strong">מדיה</h1>
          <span className="text-[13px] text-fg-muted">וידאו ותמונות מהמשחקים של הליגה</span>
        </div>
      </header>
      <div role="tablist" aria-label="מדיה" className="grid grid-cols-2 p-[3px] rounded-2xl bg-surface-sunken sm:w-[420px]">
        {TABS.map(({ id, label }) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            className={`h-11 rounded-[13px] text-sm transition-colors ${tab === id
              ? "bg-surface-raised text-fg-strong font-bold shadow-sm"
              : "text-fg-soft font-semibold hover:text-fg-strong"}`}>
            {label}
          </button>
        ))}
      </div>
      {tab === "identify" ? <MediaClusters showTitle={false} /> : <MediaLibrary />}
    </div>
  )
}

// Google Photos serves any width from the same URL (=wNNN suffix).
const sized = (url, w) => (url ? url.replace(/=w\d+(-h\d+)?.*$/, `=w${w}`) : url)

function MediaLibrary() {
  const [videos, setVideos] = useState(null)
  const [albums, setAlbums] = useState(null)
  const [tags, setTags] = useState({}) // photo_id -> [{player_id, name}]
  const [teams, setTeams] = useState({})
  const [error, setError] = useState(null)
  const [openAlbum, setOpenAlbum] = useState(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const [vids, idx, ts] = await Promise.all([getAllGameVideos(), getPhotoIndex(), getTeams()])
      setTeams(Object.fromEntries(ts.map(t => [t.id, t])))
      // One card per game; its videos are that game's parts (oldest first).
      const byGame = new Map()
      for (const v of vids) {
        if (!v.game) continue
        const g = byGame.get(v.game.id) || { game: v.game, parts: [] }
        g.parts.push(v)
        byGame.set(v.game.id, g)
      }
      const games = [...byGame.values()]
      games.forEach(g => g.parts.sort((a, b) => a.created_at.localeCompare(b.created_at)))
      games.sort((a, b) => b.game.game_date.localeCompare(a.game.game_date))
      setVideos(games)

      const byAlbum = new Map()
      for (const p of idx.photos) {
        const a = byAlbum.get(p.album_idx) || { idx: p.album_idx, title: (p.album_title || "").trim(), date: p.album_date, photos: [] }
        a.photos.push(p)
        byAlbum.set(p.album_idx, a)
      }
      const list = [...byAlbum.values()].sort((a, b) => String(b.date).localeCompare(String(a.date)))
      // Cover: the photo with the most faces tends to be the action shot, not the floor.
      list.forEach(a => { a.cover = [...a.photos].sort((x, y) => (y.n_faces || 0) - (x.n_faces || 0))[0] })
      setAlbums(list)

      const t = {}
      for (const pp of idx.photoPlayers) (t[pp.photo_id] ||= []).push(pp)
      setTags(t)
    } catch (e) {
      console.error(e)
      setError("שגיאה בטעינת המדיה")
    }
  }, [])

  useEffect(() => { load() }, [load])

  if (error) {
    return (
      <div className="fl-card p-6 flex flex-col items-center gap-3 text-center">
        <span className="text-neg text-sm font-semibold">{error}</span>
        <button onClick={load} className="btn-primary min-h-[44px]">
          <RefreshCw className="w-4 h-4" /> נסה שוב
        </button>
      </div>
    )
  }
  if (!videos || !albums) return <MediaClustersSkeleton />

  if (openAlbum) {
    return <AlbumView album={openAlbum} tags={tags} onBack={() => setOpenAlbum(null)} />
  }

  return (
    <div className="space-y-6 pt-1">
      <section aria-label="וידאו מהמשחקים">
        <h2 className="px-1 pb-2.5 text-[19px] font-extrabold text-fg-strong">וידאו מהמשחקים</h2>
        {videos.length === 0 ? (
          <div className="fl-card p-6 text-center text-sm text-fg-muted">
            עוד אין סרטונים. משחקים שישודרו מהאפליקציה יופיעו כאן אחרי המשחק.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 sm:gap-3">
            {videos.map(v => <GameVideoCard key={v.game.id} item={v} teams={teams} />)}
          </div>
        )}
      </section>

      <section aria-label="תמונות מהמשחקים">
        <h2 className="px-1 pb-2.5 text-[19px] font-extrabold text-fg-strong">תמונות מהמשחקים</h2>
        {albums.length === 0 ? (
          <div className="fl-card p-6 text-center text-sm text-fg-muted">עוד אין אלבומים.</div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5 sm:gap-3">
            {albums.map(a => <AlbumCard key={a.idx} album={a} onOpen={() => setOpenAlbum(a)} />)}
          </div>
        )}
      </section>
    </div>
  )
}

function GameVideoCard({ item, teams }) {
  const { game, parts } = item
  const home = teams[game.home_team_id], away = teams[game.away_team_id]
  const thumb = videoThumb(parts[0])
  const [thumbOk, setThumbOk] = useState(!!thumb)
  const live = game.status === "in_progress"
  const to = `${entityPath("games", game) || `/games/${game.id}`}#video`
  return (
    <Link to={to} className="fl-card overflow-hidden group block">
      <div className="relative h-[172px] sm:h-auto sm:aspect-video bg-[#11161D]">
        {thumbOk && <img src={thumb} alt="" loading="lazy" onError={() => setThumbOk(false)}
          className="absolute inset-0 w-full h-full object-cover opacity-90 group-hover:scale-[1.02] transition-transform duration-300" />}
        <div className="absolute inset-0 grid place-items-center">
          <span className="w-[52px] h-[52px] rounded-full bg-[rgba(10,14,20,.55)] grid place-items-center">
            <Play className="w-6 h-6 text-white fill-white translate-x-[-1px]" />
          </span>
        </div>
        <div className="absolute top-2 right-2 flex gap-1.5">
          {live && <span className="flex items-center gap-1 px-2 h-6 rounded-full bg-fl-live text-white text-[12px] font-bold"><Radio className="w-4 h-4" /> חי</span>}
          {game.is_test && <span className="px-2 h-6 inline-flex items-center rounded-full bg-violet-600 text-white text-[12px] font-bold"><TestGame className="w-4 h-4 inline-block" /> בדיקה</span>}
        </div>
        {parts.length > 1 && (
          <span className="absolute bottom-2 left-2 px-2 py-0.5 rounded-md bg-black/65 text-white text-[12px] font-bold"><span className="fl-num">{parts.length}</span> חלקים</span>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 px-3 py-2.5">
        <span className="flex items-center gap-1.5 min-w-0 flex-1">
          <TeamLogo team={home} px={26} disc={false} /> <span className="truncate text-[13.5px] font-bold text-fg-strong">{home?.name || "—"}</span>
        </span>
        <span className="flex flex-col items-center gap-0.5 px-2 shrink-0">
          {game.status === "completed"
            ? <FLScore home={game.home_score} away={game.away_score} size={18} className="text-fg-strong" />
            : <span className="text-[12px] text-fg-muted">נגד</span>}
          <span className="fl-num text-[11px] text-fg-muted font-normal not-italic" dir="ltr">{format(ilDate(game.game_date), "d.M")}</span>
        </span>
        <span className="flex items-center gap-1.5 min-w-0 flex-1 justify-end">
          <span className="truncate text-[13.5px] font-bold text-fg-strong">{away?.name || "—"}</span> <TeamLogo team={away} px={26} disc={false} />
        </span>
      </div>
    </Link>
  )
}

function AlbumCard({ album, onOpen }) {
  const [ok, setOk] = useState(true)
  return (
    <button onClick={onOpen} className="fl-card overflow-hidden text-right group">
      <div className="relative h-[130px] sm:h-auto sm:aspect-[4/3] bg-[#1B2532]">
        {ok && album.cover && <img referrerPolicy="no-referrer" src={sized(album.cover.image_url, 500)} alt="" loading="lazy" onError={() => setOk(false)}
          className="absolute inset-0 w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300" />}
        <span className="absolute bottom-1.5 left-1.5 px-[7px] py-0.5 rounded-[7px] bg-black/60 text-white text-[11.5px] font-bold">
          <span className="fl-num">{album.photos.length}</span> תמונות
        </span>
      </div>
      <div className="px-2.5 pt-2 pb-2.5 flex flex-col gap-0.5">
        <p className="text-[13px] font-bold leading-snug text-fg-strong line-clamp-2">{album.title}</p>
        {album.date && <p className="text-[11.5px] text-fg-muted" dir="ltr" style={{ textAlign: "right" }}>{format(new Date(album.date), "d.M.yyyy")}</p>}
      </div>
    </button>
  )
}

const ALBUM_PAGE = 48

function AlbumView({ album, tags, onBack }) {
  const [visible, setVisible] = useState(ALBUM_PAGE)
  const [open, setOpen] = useState(null) // index into album.photos
  useEffect(() => { window.scrollTo({ top: 0 }) }, [])
  return (
    <div className="space-y-4">
      <button onClick={onBack} className="min-h-[44px] flex items-center gap-1 text-sm font-bold text-fg-strong hover:underline underline-offset-4">
        <ChevronRight className="w-4 h-4" /> כל האלבומים
      </button>
      <div className="px-1">
        <h2 className="text-[21px] font-extrabold text-fg-strong leading-tight">{album.title}</h2>
        <p className="text-[12.5px] text-fg-muted mt-1">{album.date ? <span dir="ltr">{format(new Date(album.date), "d.M.yyyy")}</span> : null}{album.date ? " · " : ""}<span className="fl-num">{album.photos.length}</span> תמונות</p>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-1">
        {album.photos.slice(0, visible).map((p, i) => (
          <button key={p.photo_id} onClick={() => setOpen(i)} aria-label={`תמונה ${i + 1}`} className="relative aspect-square bg-[#1B2532] rounded-md overflow-hidden">
            <img referrerPolicy="no-referrer" src={sized(p.image_url, 300)} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover hover:opacity-90" />
            {tags[p.photo_id]?.length > 0 && (
              <span className="absolute bottom-1 left-1 w-5 h-5 rounded-full bg-black/60 text-white text-[10px] font-bold grid place-items-center">{tags[p.photo_id].length}</span>
            )}
          </button>
        ))}
      </div>
      {visible < album.photos.length && (
        <div className="flex justify-center">
          <button onClick={() => setVisible(v => v + ALBUM_PAGE)}
            className="btn-secondary w-full sm:w-auto min-h-[48px] px-6">
            עוד תמונות (<span className="fl-num">{album.photos.length - visible}</span>)
          </button>
        </div>
      )}
      {open != null && (
        <PhotoViewer photos={album.photos} index={open} tags={tags} onIndex={setOpen} onClose={() => setOpen(null)} />
      )}
    </div>
  )
}

function PhotoViewer({ photos, index, tags, onIndex, onClose }) {
  const p = photos[index]
  const prev = () => onIndex((index - 1 + photos.length) % photos.length)
  const next = () => onIndex((index + 1) % photos.length)
  useEffect(() => {
    // RTL: the "next" arrow points left.
    const onKey = (e) => {
      if (e.key === "Escape") onClose()
      else if (e.key === "ArrowLeft") next()
      else if (e.key === "ArrowRight") prev()
    }
    window.addEventListener("keydown", onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prevOverflow }
  })
  const people = tags[p.photo_id] || []
  const share = async (e) => {
    e.stopPropagation()
    const url = p.detail_url || window.location.href
    try { if (navigator.share) await navigator.share({ url }); else await navigator.clipboard?.writeText(url) } catch { /* closed */ }
  }
  const circle = "w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 grid place-items-center text-white"
  // Portalled to <body>: a transformed ancestor (page fade-in) would otherwise turn
  // `fixed` into "fixed to that ancestor" and leave a strip of page showing.
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="תמונה" className="fixed inset-0 z-[70] bg-black flex flex-col text-white" onClick={onClose}>
      <div className="flex items-center justify-between px-2 pt-[max(8px,env(safe-area-inset-top))] pb-1.5" onClick={e => e.stopPropagation()}>
        <button onClick={onClose} className={circle} aria-label="סגירה"><X className="w-5 h-5" /></button>
        <span dir="ltr" className="text-sm font-bold fl-num">{index + 1} / {photos.length}</span>
        <div className="flex items-center gap-1">
          <button onClick={share} className={circle} aria-label="שיתוף"><BrandIcon name="share" variant="large" className="w-6 h-6" /></button>
          {p.detail_url ? (
            <a href={p.detail_url} target="_blank" rel="noopener noreferrer" className={circle} aria-label="פתיחה ב־Google Photos">
              <ExternalLink className="w-5 h-5" />
            </a>
          ) : <span className="w-11" />}
        </div>
      </div>
      <div className="relative flex-1 min-h-0 flex items-center justify-center px-2 sm:px-14" onClick={e => e.stopPropagation()}>
        <img referrerPolicy="no-referrer" src={sized(p.image_url, 1600)} alt="תמונה מהמשחק" className="max-w-full max-h-full object-contain" />
        <button onClick={prev} aria-label="הקודמת" className={`absolute right-2 ${circle} bg-white/15`}><ChevronRight className="w-6 h-6" /></button>
        <button onClick={next} aria-label="הבאה" className={`absolute left-2 ${circle} bg-white/15`}><ChevronLeft className="w-6 h-6" /></button>
      </div>
      <div className="px-3 pt-3 pb-[max(20px,env(safe-area-inset-bottom))] flex flex-col items-center gap-2.5" onClick={e => e.stopPropagation()}>
        {people.some(pp => pp.player_id) && (
          <>
            <span className="text-[12.5px] opacity-75">מי בתמונה</span>
            <div className="flex flex-wrap gap-1.5 justify-center">
              {people.map(pp => pp.player_id ? (
                <Link key={pp.player_id} to={entityPath("players", pp.player_id) || `/players/${pp.player_id}`}
                  className="min-h-[40px] px-3 rounded-full bg-white/15 hover:bg-white/25 text-white text-[13px] font-bold inline-flex items-center">{pp.name}</Link>
              ) : null)}
            </div>
          </>
        )}
        <span className="text-[12px] opacity-60 hidden sm:block">חיצים במקלדת לתמונה הבאה · Esc לסגירה</span>
      </div>
    </div>,
    document.body,
  )
}

function ClusterCard({ cluster, index, summary, onSubmitted }) {
  const { user, openAuth } = useAuth()
  const [first, setFirst] = useState("")
  const [last, setLast] = useState("")
  const [state, setState] = useState("idle") // idle | sending | done | error
  const [msg, setMsg] = useState(null)
  // Cover images are Google Photos links that expire; a dead one renders a broken-image
  // box on this public page, so collapse it to the same placeholder as a missing cover.
  const [coverError, setCoverError] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (!user) { openAuth(); return } // suggesting requires login (DB blocks anon)
    if (!first.trim() || !last.trim()) { setMsg("נא למלא שם פרטי ושם משפחה"); return }
    try {
      setState("sending"); setMsg(null)
      await submitSuggestion(cluster.cluster_key, first, last)
      onSubmitted?.(`${first.trim()} ${last.trim()}`)
      setState("done")
    } catch (err) {
      console.error(err); setState("error"); setMsg(err.message || "שגיאה בשליחה")
    }
  }

  const count = summary?.suggestion_count || 0

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 12) * 0.02 }}
      className="fl-card overflow-hidden flex flex-col">
      <div className="relative bg-[#1B2532]">
        {cluster.cover_url && !coverError
          ? <img src={cluster.cover_url} alt="פני שחקן לא מזוהה" onError={() => setCoverError(true)} className="w-full object-cover" loading="lazy" />
          : <div className="h-[150px] flex items-center justify-center text-white/50"><HelpCircle className="w-8 h-8" /></div>}
        <div className="absolute top-2 right-2 px-2 py-0.5 rounded-lg bg-black/60 text-white text-[11.5px] font-bold">
          <span className="fl-num">{cluster.size}</span> תמונות
        </div>
        {count > 0 && (
          <div className="absolute top-2 left-2 px-2 py-0.5 rounded-lg bg-[#F2B233] text-[#11161D] text-[11.5px] font-bold">
            {count} {count === 1 ? "הצעה" : "הצעות"}
          </div>
        )}
      </div>

      <div className="p-2.5 flex flex-col gap-2 flex-1">
        {Array.isArray(cluster.albums) && cluster.albums.length > 0 && (
          <p className="flex items-center gap-1 text-[12px] text-fg-muted">
            <CalendarDays className="w-4 h-4 shrink-0" />
            <span className="truncate">
              {cluster.albums[0].title}
              {cluster.albums.length > 1 ? ` +${cluster.albums.length - 1}` : ""}
            </span>
          </p>
        )}
        {count > 0 && summary?.top_name && (
          <p className="text-[12.5px] text-fg-muted">
            הכי מוצע: <span className="font-bold text-fg-strong">{summary.top_name}</span>
          </p>
        )}

        {state === "done" ? (
          <div className="flex items-center gap-2 text-pos text-sm font-bold min-h-[44px]">
            <Check className="w-4 h-4" /> תודה! ההצעה נשמרה
          </div>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-2">
            <div className="flex gap-1.5">
              <input value={first} onChange={e => setFirst(e.target.value)} placeholder="שם פרטי" aria-label="שם פרטי"
                className="w-full min-w-0 h-11 rounded-xl border border-line-strong bg-surface-inset px-2.5 text-[14px] text-fg-strong placeholder:text-fg-subtle focus:outline-none focus:ring-2 focus:ring-brand/30" />
              <input value={last} onChange={e => setLast(e.target.value)} placeholder="שם משפחה" aria-label="שם משפחה"
                className="w-full min-w-0 h-11 rounded-xl border border-line-strong bg-surface-inset px-2.5 text-[14px] text-fg-strong placeholder:text-fg-subtle focus:outline-none focus:ring-2 focus:ring-brand/30" />
            </div>
            {msg && <span className="text-[12.5px] text-neg">{msg}</span>}
            <button type="submit" disabled={state === "sending"}
              className="h-11 rounded-xl bg-brand text-brand-fg text-sm font-bold inline-flex items-center justify-center gap-1.5 disabled:opacity-60">
              <Send className="w-4 h-4" /> {state === "sending" ? "שולח..." : "זה השחקן"}
            </button>
          </form>
        )}

        {cluster.source_detail_url && (
          <a href={cluster.source_detail_url} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 min-h-[36px] text-[12px] text-fg-muted hover:text-fg-strong transition-colors mt-auto">
            <ExternalLink className="w-3 h-3" /> צפו בתמונה המקורית
          </a>
        )}
      </div>
    </motion.div>
  )
}
