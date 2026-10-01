import { useState } from "react"
import { X, Search, UserPlus, Eye, EyeOff } from "lucide-react"
import { TeamSide } from "@/lib/game/rules"

/* ============================================================================
 * Game-day lineup editor for the judge board.
 *   • Hide a squad player who isn't playing today (or un-hide them).
 *   • Borrow a registered player from any other team — their stats count.
 *   • Add a free-text guest (name + number) — shows on the board, but has no
 *     player card, so nothing is saved to stats for them.
 * Stored per game in localStorage, next to the engine draft; nothing is written
 * to the DB, so the team's real roster is never touched.
 * ==========================================================================*/

const LS = (gameId) => `judge-lineup:${gameId}`
export const emptyLineup = () => ({
  home: { hidden: [], added: [], guests: [] },
  guest: { hidden: [], added: [], guests: [] },
})

export function loadLineup(gameId) {
  try {
    const raw = localStorage.getItem(LS(gameId))
    if (!raw) return emptyLineup()
    const v = JSON.parse(raw)
    const side = (x) => ({ hidden: x?.hidden || [], added: x?.added || [], guests: x?.guests || [] })
    return { home: side(v.home), guest: side(v.guest) }
  } catch { return emptyLineup() }
}

export function saveLineup(gameId, lineup) {
  try { localStorage.setItem(LS(gameId), JSON.stringify(lineup)) } catch { /* ignore */ }
}

const fullName = (p) => `${p.first_name || ""} ${p.last_name || ""}`.trim()
const byJersey = (a, b) => (a.jersey_number ?? 999) - (b.jersey_number ?? 999)

export default function LineupEditor({ T, side, setSide, teams, allTeams = [], squadFor, players, lineup, setLineup, sideKey, onClose }) {
  const [query, setQuery] = useState("")
  const [guestName, setGuestName] = useState("")
  const [guestNum, setGuestNum] = useState("")
  const key = sideKey(side)
  const l = lineup[key]
  const teamsById = Object.fromEntries([...allTeams, ...Object.values(teams).filter(Boolean)].map(t => [t.id, t]))

  const update = (patch) => setLineup({ ...lineup, [key]: { ...l, ...patch } })
  const squad = squadFor(side).sort(byJersey)
  const squadIds = new Set(squad.map(p => p.id))
  const hidden = new Set(l.hidden)
  const borrowed = l.added.map(id => players.find(p => p.id === id)).filter(p => p && !squadIds.has(p.id))
  const inLineup = new Set([...squadIds, ...borrowed.map(p => p.id)])

  const toggleHidden = (id) => update({ hidden: hidden.has(id) ? l.hidden.filter(x => x !== id) : [...l.hidden, id] })
  const addPlayer = (id) => { update({ added: [...l.added.filter(x => x !== id), id] }); setQuery("") }
  const removeBorrowed = (id) => update({ added: l.added.filter(x => x !== id) })
  const addGuest = () => {
    const name = guestName.trim()
    if (!name) return
    const n = parseInt(guestNum, 10)
    update({ guests: [...l.guests, { key: `g${Date.now()}`, name, number: Number.isFinite(n) ? n : null }] })
    setGuestName(""); setGuestNum("")
  }
  const removeGuest = (k) => update({ guests: l.guests.filter(g => g.key !== k) })

  const q = query.trim()
  const results = q.length < 1 ? [] : players
    .filter(p => !inLineup.has(p.id) && (fullName(p).includes(q) || String(p.jersey_number ?? "") === q))
    .slice(0, 8)

  const border = { borderColor: "rgba(255,255,255,0.1)" }
  const inputCls = "rounded-lg px-3 py-2 text-sm text-white placeholder-white/35 outline-none border focus:border-white/40"
  const inputStyle = { background: "rgba(255,255,255,0.06)", borderColor: "rgba(255,255,255,0.12)" }
  const Row = ({ p, children, dim }) => (
    <div className={`flex items-center gap-2 py-1.5 px-3 rounded-lg text-sm ${dim ? "opacity-40" : ""}`}>
      <span className="w-6 text-center text-[11px] font-mono text-white/40">{p.jersey_number ?? "–"}</span>
      <span className="flex-1 text-white truncate">{fullName(p)}</span>
      {p.position === "Goalkeeper" && <span className="text-[9px] font-bold" style={{ color: T.cardBlue }}>GK</span>}
      {children}
    </div>
  )

  return (
    <div className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4" dir="rtl" onClick={onClose}>
      <div className="w-full max-w-md max-h-[88vh] overflow-hidden flex flex-col rounded-2xl border" style={{ background: T.panel, borderColor: "rgba(255,255,255,0.12)" }} onClick={e => e.stopPropagation()}>
        <div className="px-4 py-3 border-b flex items-center justify-between" style={border}>
          <h4 className="font-bold text-sm text-white">סגל למשחק</h4>
          <button onClick={onClose} className="p-1 text-white/60 hover:text-white" aria-label="סגור"><X className="w-4 h-4" /></button>
        </div>

        {/* team tabs */}
        <div className="flex gap-1 p-2 border-b" style={border}>
          {[TeamSide.home, TeamSide.guest].map(s => (
            <button key={s} onClick={() => setSide(s)}
              className="flex-1 py-1.5 rounded-lg text-xs font-bold truncate transition-colors"
              style={s === side ? { background: T.accent, color: "#000" } : { color: "rgba(255,255,255,0.6)" }}>
              {teams[s]?.name || (s === TeamSide.home ? "בית" : "חוץ")}
            </button>
          ))}
        </div>

        <div className="p-2 overflow-y-auto space-y-3">
          {/* squad */}
          <section>
            <p className="px-3 pt-1 pb-1 text-[11px] font-semibold text-white/45">סגל הקבוצה · הסתר מי שלא משחק היום</p>
            {squad.length === 0 && <p className="px-3 py-2 text-xs text-white/40">אין שחקנים רשומים בקבוצה</p>}
            {squad.map(p => (
              <Row key={p.id} p={p} dim={hidden.has(p.id)}>
                <button onClick={() => toggleHidden(p.id)} className="p-1 text-white/60 hover:text-white" aria-label={hidden.has(p.id) ? "החזר לסגל" : "הסתר"}>
                  {hidden.has(p.id) ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </Row>
            ))}
          </section>

          {/* borrowed */}
          {borrowed.length > 0 && (
            <section>
              <p className="px-3 pb-1 text-[11px] font-semibold text-white/45">שחקנים מושאלים</p>
              {borrowed.map(p => (
                <Row key={p.id} p={p}>
                  <span className="text-[10px] text-white/35 truncate max-w-[6rem]">{teamsById[p.team_id]?.name || ""}</span>
                  <button onClick={() => removeBorrowed(p.id)} className="p-1 text-white/60 hover:text-white" aria-label="הסר"><X className="w-4 h-4" /></button>
                </Row>
              ))}
            </section>
          )}

          {/* add a registered player */}
          <section className="px-3 space-y-1.5">
            <p className="text-[11px] font-semibold text-white/45">הוסף שחקן רשום (מכל קבוצה)</p>
            <div className="relative">
              <Search className="w-4 h-4 absolute top-1/2 -translate-y-1/2 right-3 text-white/35" />
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="חפש לפי שם או מספר"
                className={`${inputCls} w-full pr-9`} style={inputStyle} />
            </div>
            {results.map(p => (
              <button key={p.id} onClick={() => addPlayer(p.id)} className="w-full flex items-center gap-2 py-1.5 px-2 rounded-lg text-sm text-right hover:bg-white/10">
                <span className="w-6 text-center text-[11px] font-mono text-white/40">{p.jersey_number ?? "–"}</span>
                <span className="flex-1 text-white truncate">{fullName(p)}</span>
                <span className="text-[10px] text-white/35 truncate max-w-[7rem]">{teamsById[p.team_id]?.name || "שחקן חופשי"}</span>
                <UserPlus className="w-4 h-4" style={{ color: T.accent }} />
              </button>
            ))}
            {q && results.length === 0 && <p className="text-xs text-white/40 py-1">לא נמצא שחקן</p>}
          </section>

          {/* free-text guests */}
          <section className="px-3 pb-2 space-y-1.5">
            <p className="text-[11px] font-semibold text-white/45">שחקן אורח (ללא כרטיס שחקן — לא נשמר בסטטיסטיקה)</p>
            {l.guests.map(g => (
              <div key={g.key} className="flex items-center gap-2 py-1 text-sm">
                <span className="w-6 text-center text-[11px] font-mono text-white/40">{g.number ?? "–"}</span>
                <span className="flex-1 text-white truncate">{g.name}</span>
                <button onClick={() => removeGuest(g.key)} className="p-1 text-white/60 hover:text-white" aria-label="הסר"><X className="w-4 h-4" /></button>
              </div>
            ))}
            <div className="flex gap-1.5">
              <input value={guestNum} onChange={e => setGuestNum(e.target.value.replace(/\D/g, "").slice(0, 3))} inputMode="numeric" placeholder="#"
                className={`${inputCls} w-14 text-center`} style={inputStyle} />
              <input value={guestName} onChange={e => setGuestName(e.target.value)} onKeyDown={e => e.key === "Enter" && addGuest()} placeholder="שם"
                className={`${inputCls} flex-1 min-w-0`} style={inputStyle} />
              <button onClick={addGuest} disabled={!guestName.trim()} className="px-3 rounded-lg text-xs font-bold disabled:opacity-40" style={{ background: T.accent, color: "#000" }}>הוסף</button>
            </div>
          </section>
        </div>

        <div className="p-2 border-t" style={border}>
          <button onClick={onClose} className="w-full py-2 rounded-lg text-sm font-bold" style={{ background: T.accent, color: "#000" }}>סיום</button>
        </div>
      </div>
    </div>
  )
}
