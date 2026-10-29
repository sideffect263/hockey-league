import { useState, useEffect, useCallback } from "react"
import { Loader2, RefreshCw, Check, Unlink, ExternalLink } from "lucide-react"
import { supabase } from "@/lib/supabase"

const MODES = [
  { id: "draft", label: "כטיוטה לסטודיו", hint: "כל פוסט חדש מגיע לסטודיו, ושם מאשרים אותו לפיד" },
  { id: "live", label: "ישר לפיד", hint: "כל פוסט חדש עולה מיד לפיד, בלי אישור" },
  { id: "paused", label: "מושהה", hint: "לא מייבאים כלום" },
]

const fmt = (d) => d ? new Date(d).toLocaleString("he-IL", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"

async function callSync(body) {
  const { data, error } = await supabase.functions.invoke("instagram-sync", { body })
  if (error) {
    let detail = null
    try { detail = await error.context?.json?.() } catch { /* not json */ }
    throw new Error(detail?.error || error.message)
  }
  if (data?.ok === false) throw new Error(data.error)
  return data
}

/**
 * /creators "אינסטגרם" (creator-posting.sql + edge fn instagram-sync): connect the league's
 * Instagram once, and every new post there is copied into the feed every 20 minutes — as a draft
 * to approve in the studio, or straight to the feed. The token never reaches the browser after it
 * is pasted: the status comes from the instagram_sync_status view, which leaves it out.
 */
export default function InstagramSync() {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(null)
  const [msg, setMsg] = useState(null)

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("instagram_sync_status").select("*").order("created_at")
    if (error) setErr("טעינת החיבור נכשלה"); else setRows(data || [])
  }, [])
  useEffect(() => { load() }, [load])

  const run = async (key, fn) => {
    setBusy(key); setErr(null); setMsg(null)
    try { await fn() } catch (e) { setErr(e.message || "הפעולה נכשלה") } finally { setBusy(null) }
  }

  const syncNow = () => run("sync", async () => {
    const r = await callSync({ action: "sync" })
    const n = (r.report || []).reduce((s, x) => s + (x.imported?.length || 0), 0)
    setMsg(n ? `יובאו ${n} פוסטים` : "אין פוסטים חדשים")
    await load()
  })

  if (rows === null && !err) return <div className="card p-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="card p-4 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
        <p className="font-bold text-slate-900 dark:text-white mb-1">אינסטגרם ← האתר</p>
        מה שמפרסמים באינסטגרם של הליגה מגיע לפיד באתר לבד, כל 20 דקות: התמונה או הסרטון והכיתוב.
        אפשר לייבא רק פוסטים עם האשטאג מסוים.
      </div>

      {err && <p className="text-sm text-red-600 dark:text-red-400 font-medium">{err}</p>}
      {msg && <p className="text-sm text-emerald-700 dark:text-emerald-300 font-medium flex items-center gap-1.5"><Check className="w-4 h-4" />{msg}</p>}

      {rows?.map(r => <AccountCard key={r.id} row={r} busy={busy} run={run} reload={load} />)}
      {rows?.length > 0 && (
        <button onClick={syncNow} disabled={!!busy}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-brand text-white text-sm font-bold disabled:opacity-50">
          {busy === "sync" ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} בדיקה עכשיו
        </button>
      )}

      {rows?.length === 0 && <ConnectForm busy={busy} run={run} onDone={load} />}
    </div>
  )
}

function AccountCard({ row, busy, run, reload }) {
  const [mode, setMode] = useState(row.mode)
  const [hashtag, setHashtag] = useState(row.hashtag || "")
  const dirty = mode !== row.mode || hashtag.replace(/^#/, "").trim() !== (row.hashtag || "")
  const daysLeft = row.token_expires_at ? Math.round((new Date(row.token_expires_at) - Date.now()) / 86_400_000) : null

  const save = () => run("save", async () => {
    const { error } = await supabase.rpc("instagram_sync_settings", { p_id: row.id, p_mode: mode, p_hashtag: hashtag })
    if (error) throw new Error(error.message.includes("check") ? "האשטאג לא תקין" : "השמירה נכשלה")
    await reload()
  })
  const disconnect = () => {
    if (!confirm(`לנתק את @${row.username}? פוסטים שכבר יובאו נשארים.`)) return
    run("disconnect", async () => {
      const { error } = await supabase.rpc("instagram_sync_disconnect", { p_id: row.id })
      if (error) throw new Error("הניתוק נכשל")
      await reload()
    })
  }

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <a href={`https://instagram.com/${row.username}`} target="_blank" rel="noreferrer"
          className="font-bold text-slate-900 dark:text-white inline-flex items-center gap-1" dir="ltr">
          @{row.username} <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
        </a>
        <span className="text-xs text-slate-500">יובאו {row.imported_count} · בדיקה אחרונה {fmt(row.last_run_at)}</span>
      </div>
      {row.last_error && <p className="text-xs text-red-600 dark:text-red-400 break-words">שגיאה אחרונה: {row.last_error}</p>}
      {daysLeft != null && daysLeft < 10 && (
        <p className="text-xs text-amber-700 dark:text-amber-300">החיבור יפוג בעוד {daysLeft} ימים — אם הוא לא מתחדש לבד, חברו מחדש.</p>
      )}

      <fieldset className="space-y-1.5">
        <legend className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">פוסטים חדשים מגיעים</legend>
        {MODES.map(m => (
          <label key={m.id} className="flex items-start gap-2 text-sm cursor-pointer">
            <input type="radio" name={`mode-${row.id}`} checked={mode === m.id} onChange={() => setMode(m.id)} className="mt-1 accent-brand" />
            <span><b>{m.label}</b> <span className="text-xs text-slate-500">— {m.hint}</span></span>
          </label>
        ))}
      </fieldset>

      <label className="block">
        <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">רק פוסטים עם האשטאג (ריק = הכול)</span>
        <input value={hashtag} onChange={e => setHashtag(e.target.value)} placeholder="#rinkhockeyil" dir="ltr"
          className="mt-1 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm" />
      </label>

      <div className="flex items-center gap-2">
        <button onClick={save} disabled={!dirty || !!busy}
          className="px-4 py-2 rounded-full bg-brand text-white text-sm font-bold disabled:opacity-40">
          {busy === "save" ? <Loader2 className="w-4 h-4 animate-spin" /> : "שמירה"}
        </button>
        <button onClick={disconnect} disabled={!!busy}
          className="ms-auto inline-flex items-center gap-1.5 px-3 py-2 rounded-full text-sm font-semibold text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20">
          <Unlink className="w-4 h-4" /> ניתוק
        </button>
      </div>
    </div>
  )
}

function ConnectForm({ busy, run, onDone }) {
  const [token, setToken] = useState("")
  const [mode, setMode] = useState("draft")
  const [hashtag, setHashtag] = useState("")
  const [days, setDays] = useState(0)

  const connect = () => run("connect", async () => {
    await callSync({ action: "connect", token: token.trim(), mode, hashtag, backfill_days: days })
    setToken("")
    await onDone()
  }).catch(() => {})

  return (
    <div className="card p-4 space-y-3">
      <p className="font-bold text-slate-900 dark:text-white">חיבור חשבון אינסטגרם</p>
      <ol className="list-decimal ps-5 text-xs text-slate-600 dark:text-slate-300 space-y-0.5 leading-relaxed">
        <li>החשבון צריך להיות <b>Business</b> או <b>Creator</b> (הגדרות אינסטגרם ← סוג חשבון, חינם).</li>
        <li>מנהל האתר מוסיף את החשבון לאפליקציית Meta של הליגה ומפיק <b>access token</b>.</li>
        <li>מדביקים את הטוקן כאן ולוחצים חיבור. מכאן הכול רץ לבד.</li>
      </ol>
      <label className="block">
        <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Access token</span>
        <input value={token} onChange={e => setToken(e.target.value)} dir="ltr" autoComplete="off" spellCheck={false}
          className="mt-1 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm font-mono" />
      </label>
      <div className="grid sm:grid-cols-3 gap-3">
        <label className="block">
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">פוסטים חדשים</span>
          <select value={mode} onChange={e => setMode(e.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm">
            {MODES.filter(m => m.id !== "paused").map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">האשטאג (רשות)</span>
          <input value={hashtag} onChange={e => setHashtag(e.target.value)} placeholder="#rinkhockeyil" dir="ltr"
            className="mt-1 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm" />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">לייבא גם פוסטים מ…</span>
          <select value={days} onChange={e => setDays(Number(e.target.value))}
            className="mt-1 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm">
            <option value={0}>רק מעכשיו</option>
            <option value={7}>השבוע האחרון</option>
            <option value={30}>החודש האחרון</option>
          </select>
        </label>
      </div>
      <button onClick={connect} disabled={!token.trim() || !!busy}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-brand text-white text-sm font-bold disabled:opacity-40">
        {busy === "connect" && <Loader2 className="w-4 h-4 animate-spin" />} חיבור
      </button>
    </div>
  )
}
