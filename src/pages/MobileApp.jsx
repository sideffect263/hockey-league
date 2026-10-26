import { Download, Newspaper } from "lucide-react"
import { Approved as ShieldCheck, StatsIcon as BarChart3, Bell, Trophy, Hourglass } from "@/components/icons/BrandIcons"
import { Whistle } from "@/components/icons/HockeyIcons"
import { Link } from "react-router-dom"

// Direct APK download — the file lives in public/ so Vercel serves it as a static
// asset at this path (see vercel.json for the download headers). Bump the copy in
// public/ + the VERSION label below whenever a new build ships.
const APK_URL = "/rinkhockeyIL.apk"
// Keep in step with app/build.gradle.kts whenever public/rinkhockeyIL.apk is replaced.
// This drifted three versions behind once (the page still offered 1.4.4 while 1.4.5 was
// live), so it is only the label — the in-app update banner reads the real versionCode
// that deploy-public.sh pulls out of the APK itself and writes to league_settings.
const APK_VERSION = "1.5.5 (69)"
const APK_SIZE = "‎25MB"

// iOS: LIVE on the App Store since 2026-07-16 (v1.0, build 15 — READY_FOR_SALE).
// Set IOS_LIVE=false to fall back to the "coming soon" state if ever pulled.
// NOTE: keep the /il/ storefront segment — the app is availability-restricted to
// Israel only, so the bare /app/id... URL 404s (it resolves against the US store).
const IOS_LIVE = true
const IOS_URL = "https://apps.apple.com/il/app/id6789331513"

const FEATURES = [
  { icon: Trophy, label: "טבלה ומשחקים בזמן אמת" },
  { icon: BarChart3, label: "סטטיסטיקות שחקנים וקבוצות" },
  { icon: Newspaper, label: "פיד הקהילה — פוסטים, לייקים ותגובות" },
  { icon: Whistle, label: "כלי שיפוט וטיימר משחק" },
  { icon: Bell, label: "התראות על משחקים ותוצאות" },
]

// Minimal brand glyphs — inline so no external assets / icon-lib trademark gaps.
function AndroidGlyph({ className = "w-6 h-6" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M17.6 9.48l1.84-3.18a.4.4 0 0 0-.7-.4l-1.86 3.23A11.4 11.4 0 0 0 12 8.02c-1.72 0-3.34.37-4.88 1.11L5.26 5.9a.4.4 0 1 0-.7.4L6.4 9.48A10.9 10.9 0 0 0 1 18.02h22a10.9 10.9 0 0 0-5.4-8.54zM7 15.25a1.1 1.1 0 1 1 0-2.2 1.1 1.1 0 0 1 0 2.2zm10 0a1.1 1.1 0 1 1 0-2.2 1.1 1.1 0 0 1 0 2.2z" />
    </svg>
  )
}
function AppleGlyph({ className = "w-6 h-6" }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M16.36 12.9c-.02-2.1 1.72-3.11 1.8-3.16-.98-1.44-2.5-1.63-3.05-1.66-1.3-.13-2.53.76-3.19.76-.65 0-1.67-.74-2.75-.72-1.42.02-2.72.82-3.45 2.09-1.47 2.55-.38 6.32 1.05 8.39.7 1.01 1.53 2.15 2.62 2.11 1.05-.04 1.45-.68 2.72-.68 1.27 0 1.63.68 2.74.66 1.13-.02 1.85-1.03 2.54-2.05.8-1.17 1.13-2.3 1.15-2.36-.03-.01-2.2-.85-2.22-3.37zM14.3 6.6c.58-.7.97-1.68.86-2.65-.83.03-1.84.55-2.44 1.25-.53.62-1 1.61-.87 2.56.92.07 1.87-.47 2.45-1.16z" />
    </svg>
  )
}

export default function MobileApp() {
  return (
    <div dir="rtl" className="max-w-3xl mx-auto p-4 sm:p-6 lg:p-8">
      {/* Hero */}
      <div className="flex items-center gap-3 mb-1.5">
        <img src="/logos/main-logo.png" alt="rinkhockeyIL" className="size-12 rounded-2xl object-cover ring-1 ring-line shadow-sm" />
        <div>
          <h1 className="page-title">האפליקציה של הליגה</h1>
          <p className="page-subtitle mt-0.5">rinkhockeyIL · כל הליגה בכיס</p>
        </div>
      </div>

      <p className="text-[15px] text-fg-muted leading-relaxed mt-4 mb-6">
        כל מה שיש באתר — גם באפליקציה, מהירה ונוחה יותר לנייד: טבלה חיה, משחקים ותוצאות,
        סטטיסטיקות, פיד הקהילה וכלי שיפוט. חינם, ללא פרסומות.
      </p>

      {/* Feature chips */}
      <div className="flex flex-wrap gap-2 mb-8">
        {FEATURES.map(({ icon: Icon, label }) => (
          <span key={label} className="inline-flex items-center gap-1.5 rounded-full bg-surface-sunken px-3 py-1.5 text-[13px] font-semibold text-fg-soft">
            <Icon className="w-4 h-4 text-brand shrink-0" />
            {label}
          </span>
        ))}
      </div>

      {/* Download cards */}
      <div className="grid sm:grid-cols-2 gap-4">
        {/* Android — direct APK download */}
        <div className="card p-5 flex flex-col">
          <div className="flex items-center gap-2.5 mb-1">
            <span className="flex items-center justify-center w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
              <AndroidGlyph className="w-6 h-6" />
            </span>
            <div>
              <h2 className="text-lg font-extrabold text-fg-strong leading-tight">Android</h2>
              <p className="text-xs text-fg-muted">גרסה {APK_VERSION} · {APK_SIZE}</p>
            </div>
          </div>

          <a
            href={APK_URL}
            download
            className="mt-4 inline-flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
          >
            <Download className="w-5 h-5" /> הורדת קובץ APK
          </a>

          <div className="mt-3 text-[12.5px] text-fg-muted leading-relaxed">
            <p className="font-semibold text-fg-soft mb-1">איך מתקינים:</p>
            <ol className="list-decimal pr-4 space-y-0.5">
              <li>לחצו על הכפתור להורדת הקובץ.</li>
              <li>פתחו את הקובץ שהורד ואשרו התקנה.</li>
              <li>אם מופיעה הודעה — אשרו התקנה ״ממקור לא ידוע״ להתקנה חד־פעמית.</li>
            </ol>
          </div>
        </div>

        {/* iPhone — awaiting App Store approval */}
        <div className="card p-5 flex flex-col">
          <div className="flex items-center gap-2.5 mb-1">
            <span className="flex items-center justify-center w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200">
              <AppleGlyph className="w-6 h-6" />
            </span>
            <div>
              <h2 className="text-lg font-extrabold text-fg-strong leading-tight">iPhone</h2>
              <p className="text-xs text-fg-muted">iOS · App Store</p>
            </div>
          </div>

          {IOS_LIVE ? (
            <a
              href={IOS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-slate-900 hover:bg-black dark:bg-white dark:hover:bg-slate-100 text-white dark:text-slate-900 text-sm font-bold shadow-sm transition-colors"
            >
              <AppleGlyph className="w-5 h-5" /> הורדה מ‑App Store
            </a>
          ) : (
            <div className="mt-4 inline-flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-surface-sunken text-fg-muted text-sm font-bold cursor-not-allowed" aria-disabled="true">
              <Hourglass className="w-5 h-5" /> בקרוב — ממתינה לאישור אפל
            </div>
          )}

          <p className="mt-3 text-[12.5px] text-fg-muted leading-relaxed">
            גרסת ה‑iPhone זמינה עכשיו להורדה חינמית מ‑App Store. תומכת ב‑iPhone וב‑iPad.
            אפשר גם להמשיך ולהשתמש באתר מהדפדפן בנייד.
          </p>
        </div>
      </div>

      {/* Privacy + trust */}
      <div className="mt-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-sm">
        <span className="inline-flex items-center gap-1.5 text-fg-muted">
          <ShieldCheck className="w-4 h-4 text-emerald-500" />
          ללא פרסומות · לא אוספים מיקום · לא מוכרים מידע
        </span>
        <Link to="/privacy" className="font-semibold text-brand dark:text-brand-light hover:underline">
          מדיניות פרטיות
        </Link>
      </div>
    </div>
  )
}
