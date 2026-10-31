import { useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import { motion, useReducedMotion } from "framer-motion"
import { X } from "lucide-react"
import { useAuth } from "@/lib/AuthContext"
import { supabase } from "@/lib/supabase"
import { BrandIcon, Celebrate } from "@/components/icons/BrandIcons"

/**
 * One-time surprise for the 25 OG players (players.og_number, see supabase/og-badge.sql).
 * The first time a linked OG account opens the site it gets confetti + its number; any way
 * of closing it calls ack_og(), which stamps players.og_seen_at so it never shows again on
 * any device. Mounted globally in Layout, next to <OnboardingModal/> (that one is for
 * UNlinked accounts only, so the two never collide).
 */

// Floodlight: the amber accent, paper and the league blue.
const COLORS = ["#F2B233", "#F2C230", "#FFE7A8", "#2F6FD6", "#FAF9F6", "#1550D8"]

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
      <div className="absolute inset-0 bg-black/65" onClick={close} />

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
        className="relative w-full max-w-sm rounded-[28px] p-7 text-center shadow-2xl bg-[#070B10] text-white ring-1 ring-fl-accent/50"
      >
        <button
          onClick={close}
          className="absolute top-3 left-3 size-11 rounded-full flex items-center justify-center text-white/70 hover:bg-white/10 transition-colors"
          aria-label="סגור"
        >
          <X className="w-5 h-5" />
        </button>

        <p className="text-[13px] font-extrabold text-fl-accent"><Celebrate className="w-4 h-4 inline-block align-[-3px]" /> הפתעה!</p>
        <motion.div
          initial={reduce ? false : { scale: 0.3, rotate: -12 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 200, damping: 12, delay: 0.25 }}
          className="mx-auto mt-4 mb-5 w-36 h-36 rounded-full flex flex-col items-center justify-center bg-fl-accent shadow-[0_0_60px_rgba(242,178,51,0.45)] ring-4 ring-white/15"
        >
          <BrandIcon name="og-badge" className="w-20 h-20" title="OG" />
          <span dir="ltr" className="fl-num text-[26px] text-[#11161D] mt-1">#{number}</span>
        </motion.div>

        <h2 id="og-title" className="text-[26px] font-black text-white">
          <span dir="ltr">OG <span className="fl-num">#{number}</span></span> מתוך 25
        </h2>
        <p className="text-[14.5px] text-[#D5DAE1] mt-2 leading-relaxed">
          היית בין 25 השחקנים הראשונים שחיברו את החשבון לכרטיס השחקן.
          המספר שלך קבוע לתמיד, ותג ה־OG יופיע ליד השם שלך בכל מקום באתר.
        </p>

        <button
          onClick={close}
          className="mt-6 w-full h-[52px] rounded-2xl bg-fl-accent text-[#11161D] text-[16px] font-extrabold hover:brightness-105 transition"
        >
          יאללה! <Celebrate className="w-5 h-5 inline-block align-[-3px]" />
        </button>
        <Link
          to={`/players/${playerSlug}`}
          onClick={close}
          className="mt-2 min-h-11 inline-flex items-center text-[13px] font-bold text-white/85 hover:text-white"
        >
          לכרטיס השחקן שלי
        </Link>
      </motion.div>
    </div>
  )
}
