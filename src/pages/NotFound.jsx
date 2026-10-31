import { Link, useLocation } from 'react-router-dom'
import { useSeo } from '@/lib/seo'
import { RinkDrawing } from '@/components/fl/Floodlight'
import { BrandIcon } from '@/components/icons/BrandIcons'

// Catch-all for unknown paths. Vercel's SPA rewrite serves 200 for every URL,
// so without this a mistyped link renders a blank shell under the generic title.
// We render a real Hebrew "not found" view and emit noindex so crawlers that
// reach a bad URL don't index it. Our own useSeo() runs after RouteSeo's, so
// the noindex here wins for the current (unknown) path.
//
// Floodlight (ShellStates board, "5 · דף לא נמצא"): the real 40×20 rink, the
// player from the brand icons (pose 3) skating off it, the ball already out.
export default function NotFound() {
  const { pathname } = useLocation()
  useSeo({ title: 'הדף לא נמצא', description: 'הדף שחיפשתם לא קיים', path: pathname, noindex: true })

  return (
    <div className="max-w-xl mx-auto px-6 min-h-[70vh] flex flex-col items-center justify-center text-center py-12 gap-3">
      <div className="relative w-[260px] sm:w-[320px] mb-4" aria-hidden="true">
        <RinkDrawing strength={0.6} className="w-full h-auto text-fg-muted" />
        <BrandIcon name="player-pose-3" variant="large" className="absolute -left-8 -top-8 w-[130px] h-[130px] sm:w-[150px] sm:h-[150px]" />
        <span className="absolute -left-[38px] top-[118px] w-4 h-4 rounded-full bg-[#EA580C]" />
      </div>
      <h1 className="text-[26px] font-black text-fg-strong">הכדור יצא מהמגרש</h1>
      <p className="text-[15px] text-fg-soft leading-relaxed max-w-sm">
        חיפשנו בכל המגרש. הדף הזה לא קיים או שהוסר.
      </p>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
        <Link to="/" className="h-12 px-[18px] rounded-control bg-brand text-brand-fg inline-flex items-center text-[14.5px] font-extrabold">חזרה למגרש</Link>
        <Link to="/games" className="h-12 px-4 rounded-control border border-line-strong text-fg-strong inline-flex items-center text-[14.5px] font-bold">ללוח המשחקים</Link>
      </div>
    </div>
  )
}
