import { useEffect, useState } from "react"
import { PenLine, CheckCircle2, Circle, RotateCcw } from "lucide-react"
import { Captain } from "@/components/icons/BrandIcons"
import { format } from "date-fns"
import { useAuth } from "@/lib/AuthContext"
import { getPlayerTeams, buildMemberMaps } from "@/lib/playerTeams"
import {
  SIGN_ROLES, getGameReportRow, gameCaptainIds, setGameCaptain,
  getMySignRoles, getGameSignatures, signGameForm, clearGameSignature,
  getMySavedSignature, saveMySignature, deleteMySignature, signGameFormSaved,
} from "@/lib/gameFormData"
import SignaturePad from "@/components/games/SignaturePad"
import GameSheetSection from "@/components/games/GameSheetSection"

/**
 * The game's match-sheet card: each side's captain (anyone can see it; coach, judge,
 * LM or admin can change it for this game), and — once the game is played — the
 * paper form's facts and photos (GameSheetSection) and the six signature slots of the
 * טופס שיפוט. Each person signs from their own account; the
 * server decides who may sign which slot (see supabase/game-form-signing.sql).
 */

const fullName = (p) => [p?.first_name, p?.last_name].map(s => (s || "").trim()).filter(Boolean).join(" ")

export default function GameFormCard({ game, home, away, players = [], stats = [] }) {
  const { user, isAdmin, isLeagueManager, isJudgeRole, coachTeamIds } = useAuth()
  const [reportRow, setReportRow] = useState(null)
  const [memberships, setMemberships] = useState([])
  const [myRoles, setMyRoles] = useState([])
  const [signatures, setSignatures] = useState(null)
  // The account's saved signature: undefined = not loaded / failed (offer drawing only).
  const [savedSig, setSavedSig] = useState(undefined)
  const [padRole, setPadRole] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const done = game.status === "completed"

  const load = async () => {
    const [row, mem] = await Promise.all([
      getGameReportRow(game.id).catch(() => null),
      getPlayerTeams().catch(() => []),
    ])
    setReportRow(row); setMemberships(mem)
    if (user && done) {
      const [roles, sigs] = await Promise.all([getMySignRoles(game.id).catch(() => []), getGameSignatures(game.id)])
      setMyRoles(roles); setSignatures(sigs)
      setSavedSig(roles.length > 0 ? await getMySavedSignature().catch(() => undefined) : undefined)
    } else { setMyRoles([]); setSignatures(null); setSavedSig(undefined) }
  }
  useEffect(() => { load() }, [game.id, game.status, user?.id])

  const caps = gameCaptainIds(reportRow, home, away)
  const playersById = Object.fromEntries(players.map(p => [p.id, p]))
  const { byTeam } = buildMemberMaps(memberships, players)
  const teamOf = (side) => (side === "home" ? home : away)
  const canSetCaptain = (side) => isAdmin || isLeagueManager || isJudgeRole || (coachTeamIds || []).includes(teamOf(side)?.id)
  // The team's roster plus anyone borrowed into this game for that side.
  const candidates = (side) => {
    const tid = teamOf(side)?.id
    const ids = new Set(byTeam.get(tid) || [])
    for (const s of stats) if (s.played_for_team_id === tid && s.player_id) ids.add(s.player_id)
    return [...ids].map(id => playersById[id]).filter(Boolean).sort((a, b) => fullName(a).localeCompare(fullName(b), "he"))
  }

  const changeCaptain = async (side, playerId) => {
    setBusy(true); setError(null)
    try { await setGameCaptain(game.id, side, playerId || null); await load() }
    catch (e) { console.error(e); setError("שמירת הקפטן נכשלה") }
    finally { setBusy(false) }
  }

  const roleLabel = (role) => ({
    referee: "שופט",
    medic: "חובש",
    home_coach: `מאמן/ת · ${home?.name || "מארחת"}`,
    away_coach: `מאמן/ת · ${away?.name || "אורחת"}`,
    home_captain: `קפטן · ${home?.name || "מארחת"}`,
    away_captain: `קפטן · ${away?.name || "אורחת"}`,
  }[role])

  const signErrorText = (e) => (/already signed/.test(e?.message || "") ? "מישהו אחר כבר חתם בתפקיד הזה" : "שמירת החתימה נכשלה")

  const saveSignature = async (png, remember) => {
    setBusy(true); setError(null)
    try {
      await signGameForm(game.id, padRole, png)
      setPadRole(null)
      // The form is signed either way; a failed "remember" only costs the shortcut.
      if (remember) await saveMySignature(png).catch(e => console.error(e))
      await load()
    } catch (e) { console.error(e); setError(signErrorText(e)) }
    finally { setBusy(false) }
  }

  // One tap with the saved signature.
  const approveWithSaved = async (role) => {
    setBusy(true); setError(null)
    try { await signGameFormSaved(game.id, role); await load() }
    catch (e) { console.error(e); setError(signErrorText(e)) }
    finally { setBusy(false) }
  }

  const forgetSaved = async () => {
    setBusy(true); setError(null)
    try { await deleteMySignature(); setSavedSig(null) }
    catch (e) { console.error(e); setError("מחיקת החתימה השמורה נכשלה") }
    finally { setBusy(false) }
  }

  const clearSig = async (role) => {
    setBusy(true); setError(null)
    try { await clearGameSignature(game.id, role); await load() }
    catch (e) { console.error(e); setError("מחיקת החתימה נכשלה") }
    finally { setBusy(false) }
  }

  const showSignatures = done && (signatures || myRoles.length > 0)
  const anyCaptain = caps.home || caps.away
  const anyEditor = canSetCaptain("home") || canSetCaptain("away")
  // Same rule as the game-forms bucket and set_game_sheet: officials, never a coach.
  const isOfficial = !!(isAdmin || isLeagueManager || isJudgeRole)
  const hasSheet = !!reportRow && (reportRow.home_fouls != null || reportRow.halftime_home != null ||
    reportRow.timeouts || reportRow.final_state || (reportRow.events || []).length > 0 || (reportRow.form_photos || []).length > 0)
  if (!anyCaptain && !anyEditor && !showSignatures && !(done && hasSheet)) return null

  const signedCount = signatures ? Object.keys(signatures).length : 0

  return (
    <div id="game-form" className="card p-4 sm:p-5 space-y-4 scroll-mt-20">
      <h3 className="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-2">
        <PenLine className="w-4 h-4 text-brand" /> טופס המשחק
        {showSignatures && signatures && <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">· {signedCount}/6 חתימות</span>}
      </h3>

      {/* Captains */}
      <div className="grid sm:grid-cols-2 gap-3">
        {["home", "away"].map(side => {
          const team = teamOf(side)
          const capId = caps[side]
          return (
            <div key={side} className="rounded-xl border border-line p-3">
              <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 mb-1.5">{team?.name}</div>
              {canSetCaptain(side) ? (
                <label className="flex items-center gap-2">
                  <Captain className="w-4 h-4 shrink-0" />
                  <select
                    aria-label={`קפטן ${team?.name || ""}`}
                    value={capId || ""}
                    disabled={busy}
                    onChange={(e) => changeCaptain(side, e.target.value)}
                    className="filter-select flex-1 min-w-0"
                  >
                    <option value="">{team?.captain_player_id ? "קפטן הקבוצה" : "ללא קפטן"}</option>
                    {candidates(side).map(p => <option key={p.id} value={p.id}>{fullName(p)}</option>)}
                  </select>
                </label>
              ) : (
                <div className="flex items-center gap-2 text-sm text-slate-800 dark:text-slate-100">
                  <Captain className="w-4 h-4 shrink-0" />
                  {capId ? fullName(playersById[capId]) || "—" : <span className="text-slate-400">לא נקבע קפטן</span>}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {done && (
        <GameSheetSection game={game} home={home} away={away} reportRow={reportRow}
          canEdit={isOfficial} canSeePhotos={isOfficial} onChanged={load} />
      )}

      {/* Signatures */}
      {showSignatures && (
        <div className="space-y-1.5">
          {SIGN_ROLES.map(role => {
            const sig = signatures?.[role]
            const mine = myRoles.includes(role)
            const canClear = sig && (sig.is_mine || isAdmin || isLeagueManager)
            return (
              <div key={role} className="flex items-center gap-3 py-1.5 px-2 rounded-lg hover:bg-surface-sunken">
                {sig ? <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" /> : <Circle className="w-4 h-4 text-slate-300 dark:text-slate-600 shrink-0" />}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">{roleLabel(role)}</div>
                  {sig && (
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                      {sig.signer_name || "נחתם"} · <span dir="ltr">{format(new Date(sig.signed_at), "d/M/yyyy HH:mm")}</span>
                    </div>
                  )}
                </div>
                {sig?.image && <img src={sig.image} alt="" className="h-8 w-auto max-w-[110px] rounded bg-white px-1 shrink-0" />}
                {mine && !sig && savedSig && (
                  <>
                    <img src={savedSig} alt="החתימה השמורה שלך" className="h-8 w-auto max-w-[110px] rounded bg-white px-1 shrink-0" />
                    <button onClick={() => approveWithSaved(role)} disabled={busy} className="btn-primary btn-sm shrink-0">
                      <CheckCircle2 className="w-3.5 h-3.5" /> אישור וחתימה
                    </button>
                    <button onClick={() => setPadRole(role)} disabled={busy} className="text-[11px] font-semibold text-brand shrink-0">חתימה חדשה</button>
                  </>
                )}
                {mine && !sig && !savedSig && (
                  <button onClick={() => setPadRole(role)} disabled={busy} className="btn-primary btn-sm shrink-0">
                    <PenLine className="w-3.5 h-3.5" /> חתום
                  </button>
                )}
                {mine && sig?.is_mine && (
                  <button onClick={() => setPadRole(role)} disabled={busy} className="text-[11px] font-semibold text-brand shrink-0">חתום מחדש</button>
                )}
                {canClear && (
                  <button onClick={() => clearSig(role)} disabled={busy} title="מחק חתימה" aria-label="מחק חתימה" className="p-1 text-slate-400 hover:text-red-500 shrink-0">
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )
          })}
          {savedSig && (
            <div className="flex items-center gap-2 pt-1 text-[11px] text-slate-500 dark:text-slate-400">
              החתימה שלך שמורה לחתימה מהירה ·
              <button onClick={forgetSaved} disabled={busy} className="font-semibold text-slate-500 hover:text-red-500">מחיקת החתימה השמורה</button>
            </div>
          )}
        </div>
      )}

      {error && <div className="rounded-lg px-3 py-2 text-sm bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-400">{error}</div>}

      {padRole && (
        <SignaturePad title={`חתימה — ${roleLabel(padRole)}`} saving={busy} offerRemember onCancel={() => setPadRole(null)} onSave={saveSignature} />
      )}
    </div>
  )
}
