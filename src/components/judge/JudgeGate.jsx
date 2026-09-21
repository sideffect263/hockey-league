import { useAuth } from "@/lib/AuthContext"
import { Gavel, Lock } from "lucide-react"
import { JudgeSkeleton } from "@/components/skeletons/PageSkeletons"

/**
 * Gates judge-only screens. Renders children only for admins or judge-role
 * users; otherwise shows the page skeleton / sign-in prompt / not-authorized
 * state. (hasRole('judge') already returns true for admins.)
 *
 * `skeleton` lets each gated page hand in its own shape — the gate sits above
 * two different screens (the picker and the scoreboard) and a wrong skeleton is
 * worse than none, because it promises a layout that never arrives.
 */
export default function JudgeGate({ children, skeleton }) {
  const { user, hasRole, loading, openAuth } = useAuth()

  if (loading) return skeleton || <JudgeSkeleton />

  if (!user) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 max-w-md mx-auto">
        <div className="card p-8 flex flex-col items-center text-center gap-3 min-h-[300px] justify-center">
          <Gavel className="w-10 h-10 text-brand" />
          <h1 className="text-lg font-bold text-slate-900 dark:text-white">אזור שיפוט</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">התחבר/י כדי לנהל משחקים בזמן אמת</p>
          <button onClick={openAuth} className="mt-1 px-4 py-2 rounded-lg bg-brand text-white text-sm font-semibold hover:bg-brand-hover transition-colors">
            התחברות
          </button>
        </div>
      </div>
    )
  }

  if (!hasRole("judge")) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 max-w-md mx-auto">
        <div className="card p-8 flex flex-col items-center text-center gap-3 min-h-[300px] justify-center">
          <Lock className="w-10 h-10 text-slate-500 dark:text-slate-400" />
          <h1 className="text-lg font-bold text-slate-900 dark:text-white">אזור שיפוט</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">אזור זה מיועד לשופטים בלבד. פנה/י למנהל הליגה כדי לקבל הרשאת שיפוט.</p>
        </div>
      </div>
    )
  }

  return children
}
