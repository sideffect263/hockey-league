/**
 * Game-day weather (מזג אוויר במגרש). Hourly forecast for the venue's lat/lng from
 * Open-Meteo (free, no key, CORS-open) — fetched straight from the browser, nothing
 * stored server-side. Cached per venue+day in sessionStorage for 30 minutes.
 */

const TZ = 'Asia/Jerusalem'
const CACHE_MS = 30 * 60 * 1000
/** Forecasts further out than this aren't worth showing. */
export const WEATHER_LEAD_DAYS = 7
/** After kick-off, keep the card this long if the game never moved to live/completed. */
const STALE_AFTER_KICKOFF_MS = 3 * 3600 * 1000

const HOURLY = 'temperature_2m,apparent_temperature,precipitation_probability,weather_code,wind_speed_10m,relative_humidity_2m,is_day'

/** YYYY-MM-DD and hour (0-23) of a date in Israel time. */
function israelParts(d) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(d).map(x => [x.type, x.value]))
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) }
}

/** Should the weather card show for this game right now? (time window only — the
 *  stage check lives on the page). */
export function weatherWindowOpen(gameDate, now = new Date()) {
  const kick = new Date(gameDate).getTime()
  if (!Number.isFinite(kick)) return false
  const t = now.getTime()
  return kick - t <= WEATHER_LEAD_DAYS * 86400 * 1000 && t - kick <= STALE_AFTER_KICKOFF_MS
}

function readCache(key) {
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return null
    const { at, data } = JSON.parse(raw)
    return Date.now() - at < CACHE_MS ? data : null
  } catch { return null }
}
function writeCache(key, data) {
  try { sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), data })) } catch { /* private mode */ }
}

/**
 * Hourly forecast for one Israel-time day at a venue.
 * Returns [{ hour, temp, feels, rain, code, wind, humidity, isDay }] (24 rows) or null.
 */
export async function getDayForecast(lat, lng, day) {
  const key = `wx:${lat.toFixed(3)},${lng.toFixed(3)}:${day}`
  const cached = readCache(key)
  if (cached) return cached
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}`
    + `&hourly=${HOURLY}&timezone=${encodeURIComponent(TZ)}&start_date=${day}&end_date=${day}&wind_speed_unit=kmh`
  const res = await fetch(url)
  if (!res.ok) return null
  const j = await res.json()
  const h = j?.hourly
  if (!h?.time?.length) return null
  const rows = h.time.map((t, i) => ({
    hour: Number(t.slice(11, 13)),
    temp: h.temperature_2m[i],
    feels: h.apparent_temperature[i],
    rain: h.precipitation_probability[i],
    code: h.weather_code[i],
    wind: h.wind_speed_10m[i],
    humidity: h.relative_humidity_2m[i],
    isDay: h.is_day[i] === 1,
  })).filter(r => r.temp != null)
  if (!rows.length) return null
  writeCache(key, rows)
  return rows
}

/**
 * The forecast slice the card needs: the focus hour (kick-off, or "now" while the
 * game is live) plus a strip of 4 hours around it.
 */
export async function getGameWeather({ lat, lng, gameDate, live = false, now = new Date() }) {
  if (lat == null || lng == null) return null
  const kick = israelParts(new Date(gameDate))
  const rows = await getDayForecast(Number(lat), Number(lng), kick.day)
  if (!rows) return null
  const focusHour = live ? israelParts(now).hour : kick.hour
  const at = rows.find(r => r.hour === focusHour) || null
  if (!at) return null
  const start = Math.max(0, Math.min(focusHour - 1, 20))
  const strip = rows.filter(r => r.hour >= start && r.hour < start + 4)
  return { at, strip, focusHour }
}

/** WMO weather code → Hebrew label + icon kind. */
export function describeWeather(code, isDay = true) {
  const c = Number(code)
  if (c === 0) return { label: isDay ? 'שמשי' : 'בהיר', kind: isDay ? 'sun' : 'moon' }
  if (c === 1) return { label: 'בהיר ברובו', kind: isDay ? 'sun' : 'moon' }
  if (c === 2) return { label: 'מעונן חלקית', kind: isDay ? 'partly' : 'partlyNight' }
  if (c === 3) return { label: 'מעונן', kind: 'cloud' }
  if (c === 45 || c === 48) return { label: 'ערפל', kind: 'fog' }
  if (c >= 51 && c <= 57) return { label: 'טפטוף', kind: 'drizzle' }
  if ((c >= 61 && c <= 67) || (c >= 80 && c <= 82)) return { label: c >= 65 && c !== 80 ? 'גשם חזק' : 'גשם', kind: 'rain' }
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return { label: 'שלג', kind: 'snow' }
  if (c >= 95) return { label: 'סופת רעמים', kind: 'storm' }
  return { label: '', kind: 'cloud' }
}
