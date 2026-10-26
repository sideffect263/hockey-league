import { useState, useEffect } from "react"
import { Warning as AlertTriangle } from "@/components/icons/BrandIcons"
import { format } from "date-fns"
import { getLastSync, isCloudflareBlock, CLOUDFLARE_BLOCKED } from "@/lib/podium"

/**
 * "When did we last hear from Podium?" — for every screen that shows Podium data
 * (תשלומים, and the medical queue's רשום/שילם chips). That data is a mirror, so its
 * age is part of the reading.
 *
 * There is no "sync now" button on purpose: Podium's Cloudflare turns away server
 * IPs, so the sync runs from a laptop on a schedule (scripts/podium-sync.mjs) and a
 * button could only ever report that it can't. podium_sync_runs is admin/LM-only;
 * for anyone else getLastSync() returns null and this renders nothing.
 */
export default function PodiumSyncNote({ refreshKey }) {
  const [sync, setSync] = useState(undefined)
  useEffect(() => { getLastSync().then(setSync).catch(() => setSync(null)) }, [refreshKey])

  if (sync === undefined) return null
  if (sync === null) return (
    <p className="text-xs text-slate-500 dark:text-slate-400">הנתונים מגיעים מפודיום. עדיין לא בוצע סנכרון.</p>
  )

  const at = sync.finished_at || sync.started_at
  const stale = at && (Date.now() - new Date(at)) > 24 * 3600e3

  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500 dark:text-slate-400">
        הנתונים מגיעים מפודיום.{" "}
        {sync.ok !== false && at && <>סנכרון אחרון: <span className="font-semibold tabular-nums">{format(new Date(at), "d/M/yyyy HH:mm")}</span>
          {stale && <span className="text-amber-600 dark:text-amber-400"> — לפני יותר מ-24 שעות</span>}</>}
      </p>
      {sync.ok === false && (
        <div className="card p-3 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 text-sm text-red-700 dark:text-red-400 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{isCloudflareBlock(sync.error)
            ? CLOUDFLARE_BLOCKED
            : `הסנכרון האחרון (${format(new Date(at), "d/M HH:mm")}) נכשל${sync.error ? ` — ${sync.error}` : ""}.`} הנתונים עשויים להיות ישנים.</span>
        </div>
      )}
    </div>
  )
}
