import { useState } from "react"
import { Link } from "react-router-dom"
import { Check } from "lucide-react"
import Composer from "@/components/feed/Composer"

/**
 * /creators "פוסט חדש" (2026-10-29): the creator asked how to post by himself. The feed's own
 * composer, here as the first thing he sees — text, a photo or a video, @tags, a game — posted as
 * the league account by default. Instagram posts can arrive by themselves (tab "אינסטגרם").
 */
export default function NewPost() {
  const [last, setLast] = useState(null)
  return (
    <div className="space-y-4 max-w-2xl">
      <div className="card p-4 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
        <p className="font-bold text-slate-900 dark:text-white mb-1">איך מפרסמים</p>
        <ol className="list-decimal ps-5 space-y-0.5">
          <li>כותבים טקסט (חובה). <span className="text-slate-400">@ מתייגת שחקן</span></li>
          <li>מוסיפים <b>תמונה</b> או <b>וידאו</b> (רשות) ומשייכים למשחק אם צריך.</li>
          <li>לוחצים <b>פרסם</b> — הפוסט עולה מיד לפיד.</li>
        </ol>
      </div>
      <Composer key={last?.id || "new"} onPosted={post => setLast(post)} autoFocus />
      {last && (
        <div className="card p-3 flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300">
          <Check className="w-4 h-4" /> הפוסט פורסם.
          <Link to={`/posts/${last.id}`} className="font-semibold underline">לצפייה בפוסט</Link>
        </div>
      )}
    </div>
  )
}
