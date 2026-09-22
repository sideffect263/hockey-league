import { useState, useEffect, useMemo } from "react"
import { getPaymentOverview, getUnmatchedAthletes, getLastSync, runPodiumSync, isCloudflareBlock, CLOUDFLARE_BLOCKED } from "@/lib/podium"
import { Wallet, RefreshCw, AlertTriangle, Check, X, Link2Off, Search } from "lucide-react"
import { format } from "date-fns"

/**
 * /admin → תשלומים. Who has paid the federation for this season, from the Podium
 * mirror (see src/lib/podium.js).
 *
 * The list is ordered UNPAID FIRST on purpose. A payments screen that opens on a
 * wall of green ticks makes you hunt for the six people who owe money; this one
 * opens on them. Same reasoning as the medical queue.
 *
 * Two kinds of gap, kept apart because they need different actions:
 *   • a player card with no Podium athlete  → he never registered with the federation
 *   • a Podium athlete with no player card  → he registered but has no card here
 */
export default function PaymentsAdmin() {
  const [rows, setRows] = useState(null)
  const [unmatched, setUnmatched] = useState([])
  const [sync, setSync] = useState(null)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState(null)
  const [denied, setDenied] = useState(false)
  const [q, setQ] = useState("")
  const [filter, setFilter] = useState("unpaid") // unpaid | all | missing

  const load = async () => {
    try {
      setError(null)
      const [ov, un, s] = await Promise.all([
        getPaymentOverview(), getUnmatchedAthletes(), getLastSync(),
      ])
      setRows(ov); setUnmatched(un); setSync(s)
    } catch (e) {
      if (e?.message === "not-authorized") { setDenied(true); setRows([]) }
      else { setError("שגיאה בטעינת הנתונים"); setRows([]) }
    }
  }
  useEffect(() => { load() }, [])

  const doSync = async () => {
    setSyncing(true); setError(null)
    try { await runPodiumSync(); await load() }
    catch (e) { setError(e?.message || "הסנכרון נכשל") }
    finally { setSyncing(false) }
  }

  const visible = useMemo(() => {
    const needle = q.trim()
    return (rows || []).filter(r => {
      if (filter === "unpaid" && r.paid) return false
      if (filter === "missing" && r.podium_id) return false
      if (needle && !(`${r.player_name} ${r.team_name || ""} ${r.podium_club || ""}`).includes(needle)) return false
      return true
    })
  }, [rows, q, filter])

  const stats = useMemo(() => {
    const all = rows || []
    return {
      total: all.length,
      paid: all.filter(r => r.paid).length,
      registered: all.filter(r => r.podium_id).length,
    }
  }, [rows])

  if (denied) return (
    <div className="card p-6 text-center text-sm text-slate-500 dark:text-slate-400">
      אין לך הרשאה לצפות בתשלומים
    </div>
  )
  if (rows === null) return <div className="card p-6 text-center text-sm text-slate-500">טוען…</div>

  const season = rows[0]?.season_label || ""
  const stale = sync?.finished_at && (Date.now() - new Date(sync.finished_at)) > 24 * 3600e3

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-white">
          <Wallet className="w-5 h-5 text-brand" /> תשלומים {season && <span className="text-sm font-semibold text-slate-400">עונת {season}</span>}
        </h2>
        <button onClick={doSync} disabled={syncing}
          className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50">
          <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
          {syncing ? "מסנכרן…" : "סנכרן עכשיו"}
        </button>
      </div>

      {/* The data is a mirror, so its age is part of the reading. */}
      <p className="text-xs text-slate-500 dark:text-slate-400">
        הנתונים מגיעים מפודיום ומסונכרנים ידנית.{" "}
        {sync?.finished_at
          ? <>עודכן לאחרונה {format(new Date(sync.finished_at), "d/M/yyyy HH:mm")}
              {stale && <span className="text-amber-600 dark:text-amber-400"> — מעל 24 שעות</span>}</>
          : "עדיין לא בוצע סנכרון."}
      </p>

      {sync && sync.ok === false && (
        <div className="card p-3 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 text-sm text-red-700 dark:text-red-400 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{isCloudflareBlock(sync.error)
            ? CLOUDFLARE_BLOCKED
            : `הסנכרון האחרון נכשל${sync.error ? ` — ${sync.error}` : ""}.`} הנתונים למטה עשויים להיות ישנים.</span>
        </div>
      )}
      {error && (
        <div className="card p-3 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 text-sm text-red-700 dark:text-red-400">{error}</div>
      )}

      <div className="grid grid-cols-3 gap-2">
        <Stat label="שילמו" value={`${stats.paid}/${stats.total}`} tone="emerald" />
        <Stat label="רשומים בפודיום" value={`${stats.registered}/${stats.total}`} tone="blue" />
        <Stat label="ללא כרטיס אצלנו" value={unmatched.length} tone="amber" />
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="חיפוש שחקן או קבוצה"
            className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg pr-8 pl-2 py-1.5 text-xs text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-brand/30" />
        </div>
        {[["unpaid", "לא שילמו"], ["missing", "לא רשומים"], ["all", "הכל"]].map(([k, label]) => (
          <button key={k} onClick={() => setFilter(k)}
            className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${
              filter === k
                ? "bg-brand text-white border-brand"
                : "border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700"
            }`}>{label}</button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="card p-6 text-center text-sm text-slate-500 dark:text-slate-400">
          {filter === "unpaid" ? "כולם שילמו 🎉" : "אין תוצאות"}
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map(r => (
            <div key={r.player_id} className="card p-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{r.player_name}</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  {r.team_name || "ללא קבוצה"}
                  {r.podium_club && r.podium_club !== r.team_name && <> · בפודיום: {r.podium_club}</>}
                  {r.paid && r.paid_at && <> · שולם {format(new Date(r.paid_at), "d/M/yyyy")}</>}
                  {r.paid && r.amount != null && <> · ₪{Number(r.amount).toLocaleString("he-IL")}</>}
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {!r.podium_id ? (
                  <Badge tone="amber" Icon={Link2Off} label="לא רשום בפודיום" />
                ) : r.paid ? (
                  <Badge tone="emerald" Icon={Check} label="שולם" />
                ) : (
                  <Badge tone="red" Icon={X} label="לא שולם" />
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {unmatched.length > 0 && (
        <div className="space-y-2 mt-8 pt-6 border-t border-slate-100 dark:border-slate-700/50">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">
            רשומים בפודיום ללא כרטיס שחקן אצלנו ({unmatched.length})
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            נרשמו לאיגוד אך אין להם כרטיס שחקן באתר — יש ליצור כרטיס או לשייך ידנית.
          </p>
          {unmatched.map(u => (
            <div key={u.podium_id} className="card p-3 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{u.full_name}</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                  {u.club || "—"}
                  {u.birth_date && <> · נולד {format(new Date(u.birth_date), "d/M/yyyy")}</>}
                  {u.registered_at && <> · נרשם {format(new Date(u.registered_at), "d/M/yyyy")}</>}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const TONES = {
  emerald: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  red: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  amber: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  blue: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
}

function Badge({ tone, Icon, label }) {
  return (
    <span className={`flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-lg ${TONES[tone]}`}>
      <Icon className="w-3 h-3" /> {label}
    </span>
  )
}

function Stat({ label, value, tone }) {
  return (
    <div className="card p-3 text-center">
      <p className={`text-lg font-black ${TONES[tone].split(" ").filter(c => c.startsWith("text-")).join(" ")}`}>{value}</p>
      <p className="text-[11px] text-slate-500 dark:text-slate-400">{label}</p>
    </div>
  )
}
