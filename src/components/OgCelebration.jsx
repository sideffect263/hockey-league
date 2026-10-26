import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { motion, useReducedMotion } from "framer-motion"
import { X } from "lucide-react"
import { useAuth } from "@/lib/AuthContext"
import { supabase } from "@/lib/supabase"
import { Flame } from "@/components/icons/BrandIcons"

/**
 * One-time surprise for the 25 OG players (players.og_number, see supabase/og-badge.sql).
 * The first time a linked OG account opens the site it gets confetti + its number; any way
 * of closing it calls ack_og(), which stamps players.og_seen_at so it never shows again on
 * any device. Mounted globally in Layout, next to <OnboardingModal/> (that one is for
 * UNlinked accounts only, so the two never collide).
 */

const COLORS = ["#fbbf24", "#f59e0b", "#fde68a", "#3b82f6", "#ffffff", "#1e3a8a"]

export default function OgCelebration() {
  const { user, profile, loading } = useAuth()
  const [number, setNumber] = useState(null)
  const [playerSlug, setPlayerSlug] = useState(null)
  const reduce = useReducedMotion()

  useEffect(() => {
    let alive = true
    if (loading || !user || !profile?.player_id) return
    // A failed ack must not re-open it on every navigation in this tab.
    const sessionKey = `rink-og-shown:${user.id}`
    try { if (sessionStorage.getItem(sessionKey)) return } catch { /* storage blocked */ }
    ;(async () => {
      const { data, error } = await supabase.rpc("my_og")
      if (!alive || error || !data?.number || data.seen) return
      const { data: pl } = await supabase.from("players").select("slug").eq("id", profile.player_id).maybeSingle()
      if (!alive) return
      setPlayerSlug(pl?.slug || profile.player_id)
      setNumber(data.number)
      try { sessionStorage.setItem(sessionKey, "1") } catch { /* storage blocked */ }
    })()
    return () => { alive = false }
  }, [user, profile, loading])

  const pieces = useMemo(() => Array.from({ length: 70 }, (_, i) => ({
    id: i,
    left: Math.random() * 100,
    delay: Math.random() * 0.8,
    duration: 2.4 + Math.random() * 1.8,
    rotate: Math.random() * 720 - 360,
    size: 6 + Math.random() * 6,
    color: COLORS[i % COLORS.length],
    round: Math.random() > 0.6,
  })), [])

  if (!number) return null

  const close = () => {
    setNumber(null)
    supabase.rpc("ack_og").then(({ error }) => { if (error) console.error("ack_og", error) })
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" dir="rtl" role="dialog" aria-modal="true" aria-labelledby="og-title">
      <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm" onClick={close} />

      {!reduce && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
          {pieces.map(p => (
            <motion.span
              key={p.id}
              className="absolute top-0 block"
              style={{ left: `${p.left}%`, width: p.size, height: p.round ? p.size : p.size * 0.45, backgroundColor: p.color, borderRadius: p.round ? "9999px" : "2px" }}
              initial={{ y: -40, opacity: 1, rotate: 0 }}
              animate={{ y: "105vh", opacity: [1, 1, 0.9, 0], rotate: p.rotate }}
              transition={{ duration: p.duration, delay: p.delay, ease: "easeIn" }}
            />
          ))}
        </div>
      )}

      <motion.div
        initial={reduce ? false : { scale: 0.8, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 260, damping: 20 }}
        className="relative w-full max-w-sm rounded-3xl p-7 text-center shadow-2xl bg-gradient-to-b from-slate-900 to-slate-950 ring-1 ring-amber-400/50"
      >
        <button
          onClick={close}
          className="absolute top-4 left-4 p-1.5 rounded-lg text-slate-400 hover:bg-white/10 transition-colors"
          aria-label="סגור"
        >
          <X className="w-5 h-5" />
        </button>

        <p className="text-sm font-bold text-amber-300/80">🎉 הפתעה!</p>
        <motion.div
          initial={reduce ? false : { scale: 0.3, rotate: -12 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 200, damping: 12, delay: 0.25 }}
          className="mx-auto mt-4 mb-5 w-36 h-36 rounded-full flex flex-col items-center justify-center bg-gradient-to-br from-amber-300 via-amber-400 to-amber-600 shadow-[0_0_60px_rgba(251,191,36,0.45)] ring-4 ring-amber-200/40"
        >
          <span className="text-5xl font-black tracking-wider text-slate-900 leading-none">OG</span>
          <span dir="ltr" className="text-2xl font-extrabold text-slate-900/80 mt-1">#{number}</span>
        </motion.div>

        <h2 id="og-title" className="text-2xl font-black text-white">
          <span dir="ltr">OG #{number}</span> מתוך 25
        </h2>
        <p className="text-sm text-slate-300 mt-2 leading-relaxed">
          היית בין 25 השחקנים הראשונים שחיברו את החשבון לכרטיס השחקן.
          המספר שלך קבוע לתמיד — ותג ה־OG יופיע ליד השם שלך בכל מקום באתר.
        </p>

        <button
          onClick={close}
          className="mt-6 w-full py-3 rounded-xl bg-amber-400 text-slate-900 font-extrabold hover:bg-amber-300 transition-colors"
        >
          יאללה! <Flame className="w-5 h-5 inline-block align-[-3px]" />
        </button>
        <Link
          to={`/players/${playerSlug}`}
          onClick={close}
          className="mt-3 inline-block text-xs font-semibold text-amber-300/90 hover:text-amber-200"
        >
          לכרטיס השחקן שלי ←
        </Link>
      </motion.div>
    </div>
  )
}
