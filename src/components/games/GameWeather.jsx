import { useEffect, useState } from "react"
import { Sun, Moon, CloudSun, CloudMoon, Cloud, CloudFog, CloudDrizzle, CloudRain, CloudSnow, CloudLightning, Umbrella, Wind, Droplets } from "lucide-react"
import { getGameWeather, describeWeather, weatherWindowOpen, getWeatherSettings } from "@/lib/weather"

const ICONS = {
  sun: Sun, moon: Moon, partly: CloudSun, partlyNight: CloudMoon, cloud: Cloud, fog: CloudFog,
  drizzle: CloudDrizzle, rain: CloudRain, snow: CloudSnow, storm: CloudLightning,
}
const round = (n) => Math.round(Number(n))
const hh = (h) => `${String(h).padStart(2, '0')}:00`

/**
 * מזג אוויר במגרש — forecast at the venue for kick-off (or now, while live).
 * Shown from card_lead_days (default 7) before the game until it ends; renders nothing when the venue has
 * no pin, the game is out of the window, or the forecast can't be fetched.
 */
export default function GameWeather({ game, venue, live = false }) {
  const [wx, setWx] = useState(null)
  const [cfg, setCfg] = useState(null)
  useEffect(() => { let alive = true; getWeatherSettings().then(c => { if (alive) setCfg(c) }); return () => { alive = false } }, [])
  const lat = venue?.lat, lng = venue?.lng
  // Admin switches (/admin מזג אוויר): card off, how many days ahead, indoor rinks.
  const indoor = !!venue?.name && (cfg?.indoor_venues || []).some(n => n.trim() === venue.name.trim())
  const open = !!cfg && cfg.card_enabled && !indoor && !!game?.game_date && weatherWindowOpen(game.game_date, new Date(), cfg.card_lead_days)

  useEffect(() => {
    if (!open || lat == null || lng == null) { setWx(null); return }
    let alive = true
    const load = () => getGameWeather({ lat, lng, gameDate: game.game_date, live })
      .then(r => { if (alive) setWx(r) })
      .catch(() => { if (alive) setWx(null) })
    load()
    // Hourly refresh while the page stays open (the fetch itself is cached 30 min).
    const t = setInterval(load, 60 * 60 * 1000)
    return () => { alive = false; clearInterval(t) }
  }, [open, lat, lng, game?.game_date, live])

  if (!open || !wx) return null
  const { at, strip, focusHour } = wx
  const { label, kind } = describeWeather(at.code, at.isDay)
  const Icon = ICONS[kind] || Cloud
  const place = venue?.name?.trim()

  return (
    <section aria-label="מזג אוויר במגרש" className="fl-card p-4">
      <div className="flex items-baseline justify-between gap-3 mb-3 px-0.5">
        <h2 className="text-[20px] sm:text-[22px] font-extrabold text-fg-strong leading-tight">מזג אוויר במגרש</h2>
        <span className="text-[12px] text-fg-muted">{live ? 'עכשיו' : <>בפתיחה · <span dir="ltr">{hh(focusHour)}</span></>}</span>
      </div>

      <div className="flex items-center gap-3">
        <span className="size-12 rounded-control bg-fl-accent/15 flex items-center justify-center shrink-0">
          <Icon className="w-7 h-7 text-fg-strong" strokeWidth={1.75} aria-hidden="true" />
        </span>
        <span className="fl-num text-[36px] leading-none text-fg-strong" dir="ltr">{round(at.temp)}°</span>
        <span className="flex flex-col text-[13px] leading-snug">
          {label && <span className="font-bold text-fg-strong">{label}</span>}
          <span className="text-fg-muted">מרגיש כמו <span dir="ltr">{round(at.feels)}°</span></span>
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2 mt-3">
        <Stat Icon={Umbrella} label="סיכוי לגשם" value={`${round(at.rain ?? 0)}%`} />
        <Stat Icon={Wind} label="רוח" value={`${round(at.wind)} קמ״ש`} />
        <Stat Icon={Droplets} label="לחות" value={`${round(at.humidity)}%`} />
      </div>

      {strip.length > 1 && (
        <div className="grid gap-1 mt-3 pt-3 border-t border-line text-center" style={{ gridTemplateColumns: `repeat(${strip.length}, minmax(0, 1fr))` }}>
          {strip.map(r => {
            const on = r.hour === focusHour
            const I = ICONS[describeWeather(r.code, r.isDay).kind] || Cloud
            return (
              <div key={r.hour} className={`rounded-control py-1.5 flex flex-col items-center gap-0.5 ${on ? 'bg-fl-accent/20' : ''}`}>
                <span className={`text-[11.5px] ${on ? 'text-fg-strong font-bold' : 'text-fg-muted'}`} dir="ltr">{hh(r.hour)}</span>
                <I className="w-4 h-4 text-fg-soft" strokeWidth={1.75} aria-hidden="true" />
                <span className="fl-num text-[15px] text-fg-strong" dir="ltr">{round(r.temp)}°</span>
              </div>
            )
          })}
        </div>
      )}

      <p className="text-[11px] text-fg-subtle mt-3">תחזית למיקום המגרש{place ? ` ב${place}` : ''} · מתעדכנת כל שעה</p>
    </section>
  )
}

function Stat({ Icon, label, value }) {
  return (
    <div className="rounded-control bg-surface-sunken/60 px-2.5 py-2 min-w-0">
      <span className="flex items-center gap-1 text-[11.5px] text-fg-muted truncate"><Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />{label}</span>
      <span className="block text-[14px] font-bold text-fg-strong mt-0.5 truncate">{value}</span>
    </div>
  )
}
