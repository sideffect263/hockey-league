import { useState } from "react"
import { motion } from "framer-motion"
import { X, FileSpreadsheet, Download } from "lucide-react"
import { useAuth } from "@/lib/AuthContext"
import { getGameFormSources, buildReport, defaultFormFields, guestEntries, gameFormFilename } from "@/lib/gameReport"

/**
 * Export a played game as the league's official refereeing form (טופס שיפוט), filled
 * in — same .xlsx layout the judge gets as a blank, plus a חובש section the blank
 * form has no room for.
 *
 * Most of the sheet fills itself: officials and coaches from their assignments, the
 * captains from the team / game captain, team fouls, timeouts and the half-time score
 * from the judge board's archive (games judged since 2026-10-11), and the signatures
 * people drew on the game page. The dialog shows all of it editable, and asks for what
 * nothing records (the referees' observer, which side a guest played for).
 *
 * The generator is a dynamic import — the baked form template is ~100kB and no other
 * page has any use for it.
 */

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

function downloadBytes(bytes, filename) {
  const url = URL.createObjectURL(new Blob([bytes], { type: XLSX_MIME }))
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

function Field({ label, children }) {
  return (
    <div>
      <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 block">{label}</label>
      {children}
    </div>
  )
}

function Section({ title, hint, children }) {
  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-2 border-b border-line pb-1.5">
        <h4 className="text-xs font-bold text-slate-700 dark:text-slate-200">{title}</h4>
        <span className="text-[11px] text-slate-400">{hint}</span>
      </div>
      {children}
    </div>
  )
}

/** The league logo for the form's title band — or none, rather than no form, if it won't load. */
async function leagueLogo() {
  try {
    const res = await fetch("/logos/main-logo.png")
    return res.ok ? new Uint8Array(await res.arrayBuffer()) : null
  } catch { return null }
}

export default function GameFormExport({ game, home, away, players, stats, refereeName }) {
  const { isAdmin, isJudgeRole, isLeagueManager, coachTeamIds } = useAuth()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [sources, setSources] = useState(null)
  const [fields, setFields] = useState(null)

  // Same set the game_squad / game_report_officials RPCs let read a game's roster.
  const coachOfThis = (coachTeamIds || []).some(t => t === game.home_team_id || t === game.away_team_id)
  const canExport = isAdmin || isLeagueManager || isJudgeRole || coachOfThis
  if (game.status !== "completed" || !canExport) return null

  const guests = guestEntries(stats || [])
  const set = (key) => (e) => setFields(f => ({ ...f, [key]: e.target.value }))

  const openDialog = async () => {
    setOpen(true); setError(null); setLoading(true)
    try {
      const src = await getGameFormSources(game.id)
      setSources(src)
      setFields(defaultFormFields({ game, stats: stats || [], officials: src.officials, refereeName, reportRow: src.reportRow, home, away, players: players || [] }))
    } catch (e) {
      // The squad and officials only add to what the game page already holds, so a
      // failure here downgrades the export rather than blocking it — open the dialog
      // with empty defaults instead of spinning on absent `fields`.
      console.error(e)
      setError("חלק מהנתונים לא נטענו — אפשר להשלים ידנית ולייצא")
      setSources({ squad: [], officials: [], memberships: [], reportRow: null, signatures: {} })
      setFields(defaultFormFields({ game, stats: stats || [], officials: [], refereeName, home, away, players: players || [] }))
    } finally { setLoading(false) }
  }

  const close = () => { setOpen(false); setError(null) }

  const exportForm = async () => {
    setBusy(true); setError(null)
    try {
      const { buildGameForm } = await import("@/lib/gameForm/buildGameForm")
      const report = buildReport({
        game, home, away,
        players: players || [],
        stats: stats || [],
        squad: sources?.squad || [],
        memberships: sources?.memberships || [],
        officials: sources?.officials || [],
        refereeName,
        fields,
        signatures: sources?.signatures || {},
      })
      downloadBytes(buildGameForm({ ...report, logo: await leagueLogo() }), gameFormFilename({ game, home, away }))
      close()
    } catch (e) {
      console.error(e)
      setError("שגיאה ביצירת הטופס, נסו שוב")
    } finally { setBusy(false) }
  }

  return (
    <>
      <button onClick={openDialog} className="btn-secondary btn-sm">
        <FileSpreadsheet className="w-3.5 h-3.5" /> ייצוא טופס משחק
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={close}>
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
            onClick={(e) => e.stopPropagation()}
            className="card w-full max-w-lg p-5 space-y-4 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-2 font-bold text-slate-900 dark:text-white">
                <FileSpreadsheet className="w-5 h-5 text-brand" /> ייצוא טופס משחק
              </h3>
              <button onClick={close} className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"><X className="w-4 h-4 text-slate-400" /></button>
            </div>

            <p className="text-sm text-slate-500 dark:text-slate-400">
              {home?.name || "בית"} <span className="text-slate-400">נגד</span> {away?.name || "חוץ"}
              <span className="block text-xs mt-1">
                התאריך, המגרש, השופט, ההרכבים, השערים, הכרטיסים והתוצאה ימולאו אוטומטית.
                השלימו כאן את מה שאינו נשמר במערכת.
              </span>
            </p>

            {loading || !fields ? (
              <div className="flex items-center justify-center py-10">
                <div className="animate-spin rounded-full h-8 w-8 border-2 border-brand border-t-transparent" />
              </div>
            ) : (
              <div className="space-y-5">
                <Section title="תוצאה, עבירות וקפטנים" hint="מולא מהמערכת ככל שנשמר — אפשר לתקן">
                  <Field label="תוצאת מחצית">
                    <div className="flex items-center gap-2">
                      <input type="number" min="0" value={fields.halftimeHome} onChange={set("halftimeHome")}
                        placeholder={home?.name || "מארחת"} className="filter-input flex-1" />
                      <span className="text-slate-400 text-sm">:</span>
                      <input type="number" min="0" value={fields.halftimeAway} onChange={set("halftimeAway")}
                        placeholder={away?.name || "אורחת"} className="filter-input flex-1" />
                    </div>
                  </Field>

                  <div className="grid grid-cols-2 gap-3">
                    {[["home", home, "מארחת"], ["away", away, "אורחת"]].map(([side, team, label]) => (
                      <Field key={side} label={`עבירות קבוצתיות — ${team?.name || label}`}>
                        <input type="number" min="0" value={fields[`${side}Fouls`]} onChange={set(`${side}Fouls`)} className="filter-input w-full" />
                      </Field>
                    ))}
                  </div>
                  {fields.foulsSource === "feed" && (
                    <p className="text-[11px] text-amber-600 dark:text-amber-400 -mt-1">נספר מעדכוני המשחק החי — כדאי לוודא מול השופט.</p>
                  )}
                  {!fields.foulsSource && (
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 -mt-1">לא נשמרו עבירות למשחק זה. אפשר להזין אותן מטופס השיפוט בכרטיס "טופס המשחק" בעמוד המשחק.</p>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    {[["home", home, "מארחת"], ["away", away, "אורחת"]].map(([side, team, label]) => (
                      <Field key={side} label={`קפטן — ${team?.name || label}`}>
                        <input value={fields[`${side}Captain`]} onChange={set(`${side}Captain`)} className="filter-input w-full" />
                      </Field>
                    ))}
                  </div>

                  <Field label="צופה שופטים">
                    <input value={fields.observer} onChange={set("observer")} className="filter-input w-full" />
                  </Field>

                  {guests.length > 0 && (
                    <Field label="שחקנים אורחים — לאיזו קבוצה לשייך">
                      <div className="space-y-2">
                        {guests.map(g => (
                          <div key={g.id} className="flex items-center gap-2">
                            <span className="flex-1 text-sm text-slate-600 dark:text-slate-300 truncate">
                              {g.name}{g.from ? <span className="text-xs text-slate-400"> · {g.from}</span> : null}
                            </span>
                            <select
                              value={fields.guestTeams?.[g.id] || "home"}
                              onChange={(e) => setFields(f => ({ ...f, guestTeams: { ...f.guestTeams, [g.id]: e.target.value } }))}
                              className="filter-input shrink-0"
                            >
                              <option value="home">{home?.name || "מארחת"}</option>
                              <option value="away">{away?.name || "אורחת"}</option>
                            </select>
                          </div>
                        ))}
                      </div>
                    </Field>
                  )}
                </Section>

                <Section title="מולא מהמערכת" hint="אפשר לתקן במידת הצורך">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="שם החובש">
                      <input value={fields.medic} onChange={set("medic")} placeholder="לא שובץ חובש" className="filter-input w-full" />
                    </Field>
                    <Field label="שופט נוסף">
                      <input value={fields.extraReferee} onChange={set("extraReferee")} className="filter-input w-full" />
                    </Field>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    {[["home", home, "מארחת"], ["away", away, "אורחת"]].map(([side, team, label]) => (
                      <Field key={side} label={`מאמן/ת — ${team?.name || label}`}>
                        {/* A team can have several accounts holding the coach role, so the
                            others are offered rather than hidden behind the first one. */}
                        <input value={fields[`${side}Coach`]} onChange={set(`${side}Coach`)}
                          list={`coaches-${side}`} className="filter-input w-full" />
                        <datalist id={`coaches-${side}`}>
                          {(fields.coachOptions?.[side] || []).map(name => <option key={name} value={name} />)}
                        </datalist>
                      </Field>
                    ))}
                  </div>

                  <Field label="הערות שופט">
                    <textarea value={fields.refereeNotes} onChange={set("refereeNotes")} rows={2} className="filter-input w-full resize-none" />
                  </Field>
                </Section>
              </div>
            )}

            {error && <div className="rounded-lg px-3 py-2 text-sm bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400">{error}</div>}

            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">
              {(() => {
                const n = Object.keys(sources?.signatures || {}).length
                return n ? `${n} מתוך 6 חתימות דיגיטליות יצורפו לטופס.` : "אין עדיין חתימות דיגיטליות — אפשר לחתום בעמוד המשחק."
              })()}
            </p>

            <div className="flex gap-2">
              <button onClick={exportForm} disabled={busy || loading || !fields} className="btn-primary flex-1 py-2.5">
                <Download className="w-4 h-4" /> {busy ? "מייצא…" : "ייצא טופס"}
              </button>
              <button onClick={close} className="px-4 py-2.5 text-sm font-semibold text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors">ביטול</button>
            </div>
          </motion.div>
        </div>
      )}
    </>
  )
}
