import { useState } from "react"
import { AlertTriangle, ShieldCheck } from "lucide-react"
import { REASON, REASON_LABEL } from "@/lib/eligibility"

/* ============================================================================
 * Eligibility bits shared by the judge board's player picker and lineup editor.
 * The rules live in src/lib/eligibility.js; these only render them in the board's
 * dark theme (T = THEMES preset from GameScoreboard).
 * ==========================================================================*/

/** Reason chips ("מושעה" / "אין אישור רפואי בתוקף"); muted once an admin let the player through. */
export function EligibilityChips({ reasons, T, overridden = false }) {
  if (!reasons?.length) return null
  return (
    <span className="flex items-center gap-1 shrink-0">
      {reasons.map(r => (
        <span key={r} className="px-1.5 py-0.5 rounded-full text-[9px] font-bold whitespace-nowrap"
          style={overridden
            ? { background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.45)", textDecoration: "line-through" }
            : { background: r === REASON.suspended ? `${T.cardRed}33` : `${T.strike}26`, color: r === REASON.suspended ? T.cardRed : T.strike }}>
          {REASON_LABEL[r]}
        </span>
      ))}
      {overridden && (
        <span className="flex items-center gap-0.5 text-[9px] font-bold whitespace-nowrap" style={{ color: T.passive }} title="אושר ע״י מנהל">
          <ShieldCheck className="w-3 h-3" /> אושר
        </span>
      )}
    </span>
  )
}

/** "אפשר בכל זאת" → inline confirm. Render ONLY for admin / league manager. */
export function OverrideButton({ T, onConfirm, name }) {
  const [armed, setArmed] = useState(false)
  if (!armed) {
    return (
      <button type="button" onClick={(e) => { e.stopPropagation(); setArmed(true) }}
        className="shrink-0 px-2 py-0.5 rounded-md text-[10px] font-bold border whitespace-nowrap hover:bg-white/10"
        style={{ color: T.accent, borderColor: `${T.accent}66` }}>
        אפשר בכל זאת
      </button>
    )
  }
  return (
    <span className="shrink-0 flex items-center gap-1" onClick={e => e.stopPropagation()}>
      <span className="text-[10px] text-white/60 whitespace-nowrap">{name ? `לאפשר את ${name}?` : "לאפשר?"}</span>
      <button type="button" onClick={() => { setArmed(false); onConfirm() }}
        className="px-2 py-0.5 rounded-md text-[10px] font-bold" style={{ background: T.accent, color: "#000" }}>כן</button>
      <button type="button" onClick={() => setArmed(false)}
        className="px-2 py-0.5 rounded-md text-[10px] font-bold text-white/70" style={{ background: "rgba(255,255,255,0.08)" }}>ביטול</button>
    </span>
  )
}

/** Shown when the eligibility check failed — nobody is blocked, the judge should know why. */
export function EligibilityWarning({ T }) {
  return (
    <p className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px]" style={{ background: `${T.strike}1a`, color: T.strike }}>
      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
      לא ניתן לבדוק השעיות ואישורים רפואיים — אף שחקן לא נחסם
    </p>
  )
}
