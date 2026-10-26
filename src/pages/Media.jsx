import { useState, useEffect, useCallback } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { motion } from "framer-motion"
import { format } from "date-fns"
import { Camera, HelpCircle, Check, ExternalLink, RefreshCw, Send, Images, UserSearch, Play, ChevronRight, ChevronLeft, X } from "lucide-react"
import { CalendarDays, Film, Live as Radio, PlayBadge, BrandTile } from "@/components/icons/BrandIcons"
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
export function MediaClusters() {
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
      <div className="card p-6 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 flex flex-col items-center gap-3 min-h-[240px] justify-center text-center">
        <span className="text-red-700 dark:text-red-400 text-sm font-medium">{error}</span>
        <button onClick={load} className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-semibold hover:bg-red-700 transition-colors">
          <RefreshCw className="w-3.5 h-3.5" /> נסה שוב
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="page-title flex items-center gap-2.5">
          <CameraIcon className="w-7 h-7 text-brand" /> מדיה — זיהוי שחקנים
        </h1>
        <p className="page-subtitle mt-1">
          {clusters.length} שחקנים עדיין לא זוהו · {resolved} כבר זוהו
        </p>
      </motion.div>

      <div className="card p-4 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
        אספנו תמונות מהמשחקים וקיבצנו כל שחקן לפי הפנים שלו. עזרו לנו לזהות מי מופיע בכל קבוצת תמונות —
        פשוט כתבו שם פרטי ושם משפחה מתחת לתמונות. אפשר להציע גם בלי להתחבר.
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
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
            className="px-5 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-sm font-semibold hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors">
            הצג עוד ({clusters.length - visible})
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
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto space-y-5">
      <div role="tablist" aria-label="מדיה" className="flex gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800 w-fit">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${tab === id
              ? "bg-white dark:bg-slate-900 text-brand shadow-sm"
              : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"}`}>
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>
      {tab === "identify" ? <MediaClusters /> : <MediaLibrary />}
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
      <div className="card p-6 flex flex-col items-center gap-3 text-center">
        <span className="text-red-600 dark:text-red-400 text-sm font-medium">{error}</span>
        <button onClick={load} className="flex items-center gap-1.5 px-3 py-1.5 bg-brand text-white rounded-lg text-xs font-semibold">
          <RefreshCw className="w-3.5 h-3.5" /> נסה שוב
        </button>
      </div>
    )
  }
  if (!videos || !albums) return <MediaClustersSkeleton />

  if (openAlbum) {
    return <AlbumView album={openAlbum} tags={tags} onBack={() => setOpenAlbum(null)} />
  }

  return (
    <div className="space-y-8">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="page-title flex items-center gap-2.5">
          <BrandTile name="highlights" className="w-10 h-10 -my-1.5" /> מדיה
        </h1>
        <p className="page-subtitle mt-1">וידאו ותמונות מהמשחקים של הליגה</p>
      </motion.div>

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 font-bold text-slate-900 dark:text-white">
          <Film className="w-5 h-5 text-brand" /> וידאו מהמשחקים
        </h2>
        {videos.length === 0 ? (
          <div className="card p-6 text-center text-sm text-slate-500 dark:text-slate-400">
            עוד אין סרטונים. משחקים שישודרו מהאפליקציה יופיעו כאן אחרי המשחק.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {videos.map(v => <GameVideoCard key={v.game.id} item={v} teams={teams} />)}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 font-bold text-slate-900 dark:text-white">
          <Images className="w-5 h-5 text-brand" /> תמונות מהמשחקים
        </h2>
        {albums.length === 0 ? (
          <div className="card p-6 text-center text-sm text-slate-500 dark:text-slate-400">עוד אין אלבומים.</div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
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
    <Link to={to} className="card overflow-hidden group block hover:shadow-md transition-shadow">
      <div className="relative aspect-video bg-slate-900">
        {thumbOk && <img src={thumb} alt="" loading="lazy" onError={() => setThumbOk(false)}
          className="absolute inset-0 w-full h-full object-cover group-hover:scale-[1.02] transition-transform" />}
        <div className="absolute inset-0 grid place-items-center">
          <PlayBadge className="w-12 h-12 drop-shadow" />
        </div>
        <div className="absolute top-2 right-2 flex gap-1.5">
          {live && <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-600 text-white text-[11px] font-bold"><Radio className="w-4 h-4 animate-pulse" /> חי</span>}
          {game.is_test && <span className="px-2 py-0.5 rounded-full bg-violet-600 text-white text-[11px] font-bold">🧪 בדיקה</span>}
        </div>
        {parts.length > 1 && (
          <span className="absolute bottom-2 left-2 px-2 py-0.5 rounded-md bg-black/65 text-white text-[11px] font-semibold">{parts.length} חלקים</span>
        )}
      </div>
      <div className="p-3 space-y-1">
        <div className="flex items-center justify-between gap-2 text-sm font-bold text-slate-900 dark:text-white">
          <span className="flex items-center gap-1.5 min-w-0">
            <TeamLogo team={home} size={5} /> <span className="truncate">{home?.name || "—"}</span>
          </span>
          {game.status === "completed"
            ? <span dir="ltr" className="tabular-nums shrink-0">{game.away_score} : {game.home_score}</span>
            : <span className="text-xs text-slate-400 shrink-0">נגד</span>}
          <span className="flex items-center gap-1.5 min-w-0 justify-end">
            <span className="truncate">{away?.name || "—"}</span> <TeamLogo team={away} size={5} />
          </span>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400" dir="ltr" style={{ textAlign: "right" }}>
          {format(ilDate(game.game_date), "d/M/yyyy")}
        </p>
      </div>
    </Link>
  )
}

function AlbumCard({ album, onOpen }) {
  const [ok, setOk] = useState(true)
  return (
    <button onClick={onOpen} className="card overflow-hidden text-right group hover:shadow-md transition-shadow">
      <div className="relative aspect-[4/3] bg-slate-200 dark:bg-slate-800">
        {ok && album.cover && <img referrerPolicy="no-referrer" src={sized(album.cover.image_url, 500)} alt="" loading="lazy" onError={() => setOk(false)}
          className="absolute inset-0 w-full h-full object-cover group-hover:scale-[1.03] transition-transform" />}
        <span className="absolute bottom-2 left-2 px-2 py-0.5 rounded-md bg-black/60 text-white text-[11px] font-semibold flex items-center gap-1">
          <Images className="w-3 h-3" /> {album.photos.length}
        </span>
      </div>
      <div className="p-3">
        <p className="text-sm font-bold text-slate-900 dark:text-white line-clamp-2">{album.title}</p>
        {album.date && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5" dir="ltr" style={{ textAlign: "right" }}>{format(new Date(album.date), "d/M/yyyy")}</p>}
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
      <button onClick={onBack} className="flex items-center gap-1 text-sm font-semibold text-brand hover:underline">
        <ChevronRight className="w-4 h-4" /> כל המדיה
      </button>
      <div>
        <h1 className="page-title">{album.title}</h1>
        <p className="page-subtitle mt-1">{album.photos.length} תמונות{album.date ? ` · ${format(new Date(album.date), "d/M/yyyy")}` : ""}</p>
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-1.5">
        {album.photos.slice(0, visible).map((p, i) => (
          <button key={p.photo_id} onClick={() => setOpen(i)} className="relative aspect-square bg-slate-200 dark:bg-slate-800 rounded-md overflow-hidden">
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
            className="px-5 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-sm font-semibold hover:bg-slate-200 dark:hover:bg-slate-700">
            הצג עוד ({album.photos.length - visible})
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
  return (
    <div role="dialog" aria-modal="true" aria-label="תמונה" className="fixed inset-0 z-50 bg-black/90 flex flex-col" onClick={onClose}>
      <div className="flex items-center justify-between p-3 text-white text-sm" onClick={e => e.stopPropagation()}>
        <span dir="ltr">{index + 1} / {photos.length}</span>
        <div className="flex items-center gap-1">
          {p.detail_url && (
            <a href={p.detail_url} target="_blank" rel="noopener noreferrer" className="p-2 rounded-lg hover:bg-white/10" title="פתח ב-Google Photos">
              <ExternalLink className="w-5 h-5" />
            </a>
          )}
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/10" aria-label="סגור"><X className="w-5 h-5" /></button>
        </div>
      </div>
      <div className="relative flex-1 min-h-0 flex items-center justify-center px-12" onClick={e => e.stopPropagation()}>
        <img referrerPolicy="no-referrer" src={sized(p.image_url, 1600)} alt="" className="max-w-full max-h-full object-contain" />
        <button onClick={prev} aria-label="הקודמת" className="absolute right-2 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white"><ChevronRight className="w-6 h-6" /></button>
        <button onClick={next} aria-label="הבאה" className="absolute left-2 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white"><ChevronLeft className="w-6 h-6" /></button>
      </div>
      {people.length > 0 && (
        <div className="p-3 flex flex-wrap gap-1.5 justify-center" onClick={e => e.stopPropagation()}>
          {people.map(pp => pp.player_id ? (
            <Link key={pp.player_id} to={entityPath("players", pp.player_id) || `/players/${pp.player_id}`}
              className="px-2.5 py-1 rounded-full bg-white/15 hover:bg-white/25 text-white text-xs font-semibold">{pp.name}</Link>
          ) : null)}
        </div>
      )}
    </div>
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
      className="card overflow-hidden flex flex-col">
      <div className="relative bg-slate-900">
        {cluster.cover_url && !coverError
          ? <img src={cluster.cover_url} alt="פני שחקן לא מזוהה" onError={() => setCoverError(true)} className="w-full object-cover" loading="lazy" />
          : <div className="aspect-video flex items-center justify-center text-slate-500"><HelpCircle className="w-8 h-8" /></div>}
        <div className="absolute top-2 right-2 flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/60 text-white text-[11px] font-medium backdrop-blur-sm">
          <HelpCircle className="w-3 h-3" /> {cluster.size} תמונות
        </div>
        {count > 0 && (
          <div className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-brand/90 text-white text-[11px] font-semibold">
            {count} {count === 1 ? "הצעה" : "הצעות"}
          </div>
        )}
      </div>

      <div className="p-3 flex flex-col gap-2 flex-1">
        {Array.isArray(cluster.albums) && cluster.albums.length > 0 && (
          <p className="flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
            <CalendarDays className="w-4 h-4 shrink-0" />
            <span className="truncate">
              {cluster.albums[0].title}
              {cluster.albums.length > 1 ? ` +${cluster.albums.length - 1}` : ""}
            </span>
          </p>
        )}
        {count > 0 && summary?.top_name && (
          <p className="text-xs text-slate-500 dark:text-slate-400">
            הכי מוצע: <span className="font-semibold text-slate-700 dark:text-slate-200">{summary.top_name}</span>
          </p>
        )}

        {state === "done" ? (
          <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 text-sm font-medium py-2">
            <Check className="w-4 h-4" /> תודה! ההצעה נשמרה
          </div>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-2">
            <div className="flex gap-2">
              <input value={first} onChange={e => setFirst(e.target.value)} placeholder="שם פרטי" aria-label="שם פרטי"
                className="filter-input w-full text-sm" />
              <input value={last} onChange={e => setLast(e.target.value)} placeholder="שם משפחה" aria-label="שם משפחה"
                className="filter-input w-full text-sm" />
            </div>
            {msg && <span className="text-xs text-red-600 dark:text-red-400">{msg}</span>}
            <button type="submit" disabled={state === "sending"}
              className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand text-white text-sm font-semibold hover:bg-brand-hover disabled:opacity-60 transition-colors">
              <Send className="w-3.5 h-3.5" /> {state === "sending" ? "שולח..." : "זה השחקן"}
            </button>
          </form>
        )}

        {cluster.source_detail_url && (
          <a href={cluster.source_detail_url} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-brand transition-colors mt-auto pt-1">
            <ExternalLink className="w-3 h-3" /> צפו בתמונה המקורית
          </a>
        )}
      </div>
    </motion.div>
  )
}
