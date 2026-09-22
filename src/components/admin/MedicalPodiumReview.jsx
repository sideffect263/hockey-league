import { useState, useEffect } from "react"
import { getPendingManagerMedical, approveMedicalPodium, revokeMedical, signMedical } from "@/lib/medical"
import { ShieldCheck, Check, X, Eye, RefreshCw, Clock, BadgeCheck, Link2Off, Wallet, RotateCcw } from "lucide-react"
import { format } from "date-fns"

/**
 * Stage 2 of medical approval (Uri, 2026-09-22) — league manager / admin only.
 *
 * A coach has already checked the physical itself; what is left is confirming the
 * player is registered in פודיום. Until that happens the certificate stays in
 * 'pending_manager' and the player cannot be registered for a game, so this queue
 * is the thing standing between a player and the score sheet — it shows how long
 * each one has been waiting rather than hiding it.
 *
 * Two outcomes:
 *   אישור  -> approved. Done, the player can play.
 *   דחייה  -> revoke, with a reason that reaches the player and his coach.
 *
 * There used to be a third, "טרם בפודיום", from before the Podium mirror existed —
 * a manager pressing a button to record what the sync now tells us about the whole
 * roster at once. Removed: the row states it, she does not have to.
 *
 * Each row also carries what the Podium mirror already knows (src/lib/podium.js) —
 * whether he is registered there, whether he paid this season, and when his Podium
 * medical expires. That is the point of the mirror: the manager confirms what the row
 * says instead of opening podiumcomp.com per player. It is a MIRROR though, synced
 * every 6h, so it informs the decision and never makes it — the buttons stay hers.
 */
export default function MedicalPodiumReview() {
  const [items, setItems] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState(null)
  const [denied, setDenied] = useState(false)

  const load = async () => {
    try { setError(null); setItems(await getPendingManagerMedical()) }
    catch (e) {
      if (e?.message === "not-authorized") { setDenied(true); setItems([]) }
      else { setError("שגיאה בטעינת הרשימה"); setItems([]) }
    }
  }
  useEffect(() => { load() }, [])

  /**
   * The mirror is only as fresh as the last sync, so a player who registered this
   * morning can still read as "not in Podium". The approve button is therefore never
   * disabled on that basis — it just asks first, so the default is right and the
   * manager keeps the final say.
   */
  const confirm = async (item) => {
    if (!item.in_podium && !window.confirm(
      `${item.player_name} לא נמצא בפודיום לפי הסנכרון האחרון.\n\nלאשר בכל זאת?`)) return
    setBusyId(item.id); setError(null)
    try {
      await approveMedicalPodium(item.id)
      setItems(prev => (prev || []).filter(i => i.id !== item.id))
    } catch (e) { setError(e?.message || "הפעולה נכשלה") }
    finally { setBusyId(null) }
  }

  const reject = async (item) => {
    const reason = window.prompt(`דחיית האישור של ${item.player_name} — מה הסיבה?\n(הסיבה תישלח לשחקן ולמאמן)`)
    if (reason === null) return
    setBusyId(item.id); setError(null)
    try {
      await revokeMedical(item.id, reason)
      setItems(prev => (prev || []).filter(i => i.id !== item.id))
    } catch (e) { setError(e?.message || "הדחייה נכשלה") }
    finally { setBusyId(null) }
  }

  const view = async (item) => {
    const url = await signMedical(item.file_path)
    if (url) window.open(url, "_blank", "noopener,noreferrer")
  }

  const reinspecting = (items || []).filter(i => i.reinspection).length
  const notInPodium = (items || []).filter(i => !i.in_podium).length

  if (denied || items === null) return null

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-white">
          <ShieldCheck className="w-5 h-5 text-brand" /> ממתינים לאישור המנהלת
          {items.length > 0 && (
            <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
              {items.length}
            </span>
          )}
        </h2>
        <button onClick={load} className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
          <RefreshCw className="w-3.5 h-3.5" /> רענון
        </button>
      </div>

      <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
        המאמן כבר אישר את הבדיקה הרפואית. נותר לוודא שהשחקן רשום בפודיום — עד לאישור כאן
        השחקן <strong>אינו יכול להירשם למשחקים</strong>.
        {reinspecting > 0 && <> {" "}
          <strong>{reinspecting}</strong> מתוכם סומנו לבדיקה חוזרת — שחקנים שאושרו בעבר
          וממתינים כעת לאישור מחדש.</>}
      </p>

      {/* The ones with no Podium record cannot be cleared by anyone yet, however fast
          the manager works — say so once, up front, instead of letting her discover
          it row by row. */}
      {notInPodium > 0 && (
        <div className="card p-3 border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 text-xs text-amber-800 dark:text-amber-300">
          <strong>{notInPodium}</strong> מהשחקנים ברשימה עדיין לא נרשמו בפודיום, ולכן לא
          ניתן לאשר אותם כעת — יש להשלים את הרישום לאיגוד תחילה. הם מוצגים בתחתית הרשימה.
        </div>
      )}

      {error && (
        <div className="card p-3 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 text-sm text-red-700 dark:text-red-400">{error}</div>
      )}

      {items.length === 0 ? (
        <div className="card p-6 text-center text-sm text-slate-500 dark:text-slate-400">
          אין אישורים שממתינים לאימות 🎉
        </div>
      ) : (
        <div className="space-y-2.5">
          {items.map(item => {
            const busy = busyId === item.id
            // How long this player has been blocked — the number that should make
            // someone act, so it is not buried in a tooltip.
            const since = item.coach_reviewed_at || item.created_at
            const days = Math.floor((Date.now() - new Date(since)) / 86400000)
            return (
              <div key={item.id} className="card p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-slate-900 dark:text-white truncate">
                    {item.player_name || "שחקן"}
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {item.team_name || "—"}
                    {item.exam_date && <> · בדיקה {format(new Date(item.exam_date), "d/M/yyyy")}</>}
                    {item.expires_at && <> · בתוקף עד {format(new Date(item.expires_at), "d/M/yyyy")}</>}
                  </p>
                  <p className="mt-1 flex items-center gap-1.5 text-[11px] text-amber-600 dark:text-amber-400">
                    <Clock className="w-3 h-3" />
                    ממתין {days === 0 ? "מהיום" : `${days} ${days === 1 ? "יום" : "ימים"}`}
                    {item.coach_name && <> · אישר {item.coach_name}</>}
                  </p>
                  {/* What the Podium mirror already knows — a hint, not a decision. */}
                  <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                    {item.in_podium ? (
                      <Chip tone="emerald" Icon={BadgeCheck}
                        label={`רשום בפודיום${item.podium_club ? ` · ${item.podium_club}` : ""}`} />
                    ) : (
                      <Chip tone="slate" Icon={Link2Off} label="לא נמצא בפודיום" />
                    )}
                    {item.in_podium && (
                      <Chip tone={item.podium_paid ? "emerald" : "red"} Icon={Wallet}
                        label={item.podium_paid ? "שילם" : "לא שילם"} />
                    )}
                    {item.podium_matched_by === "name" && (
                      <Chip tone="amber" Icon={Clock} label="שויך לפי שם בלבד" />
                    )}
                    {/* A swept row is not a new player — he was cleared under the old
                        one-stage rule and is blocked right now by our own sweep. */}
                    {item.reinspection && (
                      <Chip tone="blue" Icon={RotateCcw} label="בדיקה חוזרת" />
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0 flex-wrap">
                  <button onClick={() => view(item)}
                    className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
                    <Eye className="w-3.5 h-3.5" /> צפייה בבדיקה
                  </button>
                  {/* Emphasis follows the mirror: a confirmed row gets the primary
                      button, an unconfirmed one a muted "anyway" that asks first. */}
                  <button onClick={() => confirm(item)} disabled={busy}
                    className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg transition-colors disabled:opacity-50 ${
                      item.in_podium
                        ? "bg-emerald-500 text-white hover:bg-emerald-600"
                        : "border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/30"
                    }`}>
                    <Check className="w-3.5 h-3.5" /> {item.in_podium ? "אישור" : "אישור בכל זאת"}
                  </button>
                  <button onClick={() => reject(item)} disabled={busy}
                    className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50">
                    <X className="w-3.5 h-3.5" /> דחייה
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

const CHIP_TONES = {
  emerald: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  red: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  amber: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  slate: "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300",
  blue: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
}

function Chip({ tone, Icon, label }) {
  return (
    <span className={`flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded ${CHIP_TONES[tone]}`}>
      <Icon className="w-2.5 h-2.5" /> {label}
    </span>
  )
}
