import { useState, useRef, useEffect } from "react"
import { motion } from "framer-motion"
import { Stethoscope, Play, Copy, Check, Shield, AlertTriangle, CheckCircle2, XCircle } from "lucide-react"
import { useAuth } from "@/lib/AuthContext"
import { useSeo } from "@/lib/seo"
import { supabase } from "@/lib/supabase"
import { getViewerIceServersDetailed } from "@/lib/video"
import { probeIce, playWHEP, hasTurn } from "@/lib/whep"
import { GenericPageSkeleton } from "@/components/skeletons/PageSkeletons"

/**
 * Admin-only stream diagnostics — /stream-debug
 *
 * The live stream is WebRTC-only (Cloudflare serves no HLS for a browser-published
 * broadcast), so a viewer who can't watch fails somewhere along a four-leg path:
 *
 *   1. turn-creds  — can this device even fetch TURN credentials?
 *   2. ICE gather  — does the network let it reach the TURN relay at all?
 *   3. WHEP POST   — does Cloudflare accept the offer (CORS / DNS / 409 not-live)?
 *   4. connect     — does media actually flow once ICE picks a pair?
 *
 * On a permissive network legs 1-3 barely matter, which is why a stream that works
 * on the broadcaster's wifi can be a black screen everywhere else. This page runs
 * each leg separately, ON THE FAILING DEVICE, using the exact production helpers —
 * so the result is the real answer, not a simulation of it.
 */
export default function StreamDebug() {
  const { user, isAdmin, loading: authLoading } = useAuth()
  useSeo({ title: "אבחון שידור", description: "כלי אבחון לשידור החי", path: "/stream-debug", noindex: true })

  const [report, setReport] = useState({})
  const [busy, setBusy] = useState(null)
  const [rows, setRows] = useState([])
  const [manual, setManual] = useState({ code: "", uid: "" })
  const [copied, setCopied] = useState(false)
  const [live, setLive] = useState(false)
  const videoRef = useRef(null)
  const whepRef = useRef(null)

  // A running WHEP session holds a Cloudflare viewer slot open — always release it
  // when starting another test or leaving the page.
  const stopSession = () => {
    try { whepRef.current?.stop?.() } catch { /* ignore */ }
    whepRef.current = null
    setLive(false)
  }
  useEffect(() => () => {
    try { whepRef.current?.stop?.() } catch { /* ignore */ }
  }, [])

  // Recent Cloudflare rows so the admin can test against a real broadcast with one
  // click instead of hand-copying ids. Public anon SELECT, same as the player uses.
  useEffect(() => {
    if (!isAdmin) return
    supabase
      .from("game_videos")
      .select("id, game_id, video_id, cf_customer_code, kind, created_at")
      .eq("provider", "cloudflare")
      .order("created_at", { ascending: false })
      .limit(5)
      .then(({ data }) => setRows(data || []))
  }, [isAdmin])

  const set = (k, v) => setReport((r) => ({ ...r, [k]: v }))

  // ---- Legs 1 + 2: credentials and what the network allows. No Cloudflare yet.
  const runNetwork = async () => {
    setBusy("network")
    set("env", {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      // Effective connection type hints at cellular, the classic failing case.
      connection: navigator.connection?.effectiveType || null,
      saveData: navigator.connection?.saveData ?? null,
      webrtc: typeof RTCPeerConnection === "function",
      at: new Date().toISOString(),
    })

    const ice = await getViewerIceServersDetailed()
    set("turnCreds", {
      ok: !!ice.iceServers && !ice.error,
      ms: ice.ms,
      error: ice.error,
      hasTurn: hasTurn(ice.iceServers),
      urls: (ice.iceServers || []).flatMap((s) => (Array.isArray(s.urls) ? s.urls : [s.urls])),
    })

    // 'all' shows what the browser would normally use; 'relay' forces TURN, which
    // is the decisive test — if relay-only gathers nothing, TURN is blocked here.
    try { set("iceAll", await probeIce(ice.iceServers, { policy: null })) }
    catch (e) { set("iceAll", { error: String(e?.message || e) }) }
    try { set("iceRelay", await probeIce(ice.iceServers, { policy: "relay" })) }
    catch (e) { set("iceRelay", { error: String(e?.message || e) }) }

    setBusy(null)
  }

  // ---- Legs 3 + 4: the real handshake against a real live input, then a media
  // check. ICE can connect and still deliver nothing, so bytes are the only proof.
  // On success the session is LEFT RUNNING — seeing the actual picture on the
  // failing device is the point, and stopping at the 4s mark would hide it.
  const runWhep = async (code, uid, policy = null) => {
    if (!code || !uid) return
    stopSession()
    setBusy("whep")
    const key = policy === "relay" ? "whepRelay" : "whep"
    const ice = await getViewerIceServersDetailed()
    const playUrl = `https://customer-${code}.cloudflarestream.com/${uid}/webRTC/play`
    try {
      // playWHEP now waits for real bytes itself and throws `no-media` if none
      // arrive, so reaching here means media is genuinely flowing.
      const session = await playWHEP(playUrl, ice.iceServers, videoRef.current, { policy })
      whepRef.current = session
      setLive(true)
      set(key, { ok: true, playUrl, ...session.diag })
    } catch (e) {
      // playWHEP tears its own connection down on every throw.
      set(key, { ok: false, playUrl, ...(e?.diag || {}), error: String(e?.message || e) })
    } finally {
      setBusy(null)
    }
  }

  const copyReport = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2))
      setCopied(true); setTimeout(() => setCopied(false), 2000)
    } catch { /* clipboard blocked — the raw JSON is on screen anyway */ }
  }

  if (authLoading) return <GenericPageSkeleton />

  if (!user || !isAdmin) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="card p-8 sm:p-12 text-center max-w-md mx-4">
          <Shield className="w-16 h-16 text-slate-300 dark:text-slate-600 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-2">גישת מנהלים</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            דף אבחון השידור פתוח למנהלים בלבד.
          </p>
        </div>
      </div>
    )
  }

  const verdict = buildVerdict(report)

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto space-y-5">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="page-title flex items-center gap-2.5">
          <Stethoscope className="w-7 h-7 text-brand" /> אבחון שידור
        </h1>
        <p className="page-subtitle mt-1">
          הריצו את הבדיקות <b>על המכשיר שלא מצליח לצפות</b> — התוצאה מצביעה על השלב שנכשל.
        </p>
      </motion.div>

      {verdict && (
        <div className={`card p-4 flex items-start gap-3 ${verdict.ok ? "border-r-4 border-emerald-500" : "border-r-4 border-amber-500"}`}>
          {verdict.ok
            ? <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
            : <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />}
          <div>
            <p className="font-bold text-sm text-slate-900 dark:text-white">{verdict.title}</p>
            <p className="text-sm text-slate-600 dark:text-slate-300 mt-0.5">{verdict.detail}</p>
          </div>
        </div>
      )}

      {/* ---- Step 1: network + credentials, no Cloudflare involved ------------ */}
      <Section title="1. רשת והרשאות TURN" subtitle="בודק אם המכשיר מקבל פרטי TURN ומצליח להגיע ל-relay">
        <button onClick={runNetwork} disabled={!!busy}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-brand hover:opacity-90 disabled:opacity-50 transition-opacity">
          <Play className="w-4 h-4" /> {busy === "network" ? "בודק…" : "הרץ בדיקת רשת"}
        </button>

        {report.turnCreds && (
          <Result ok={report.turnCreds.ok && report.turnCreds.hasTurn} label="turn-creds">
            {report.turnCreds.ok
              ? `הצליח ב-${report.turnCreds.ms}ms · TURN ברשימה: ${report.turnCreds.hasTurn ? "כן" : "לא"}`
              : `נכשל: ${report.turnCreds.error}`}
          </Result>
        )}
        {report.iceAll && (
          <Result ok={!!report.iceAll.types?.relay} label="איסוף ICE (רגיל)">
            {fmtProbe(report.iceAll)}
          </Result>
        )}
        {report.iceRelay && (
          <Result ok={!!report.iceRelay.types?.relay} label="איסוף ICE (relay בלבד)">
            {fmtProbe(report.iceRelay)}
            {!report.iceRelay.types?.relay && (
              <div className="mt-1 text-amber-700 dark:text-amber-400">
                הרשת חוסמת את שרתי ה-TURN. Cloudflare מאזין ב-3478 (UDP/TCP) וב-5349 (TLS) — לא ב-443.
              </div>
            )}
          </Result>
        )}
        {report.iceAll?.errors?.length > 0 && (
          <pre dir="ltr" className="mt-2 p-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-[11px] overflow-x-auto text-left">
            {JSON.stringify(report.iceAll.errors, null, 2)}
          </pre>
        )}
      </Section>

      {/* ---- Step 2: the real handshake against a real broadcast -------------- */}
      <Section title="2. חיבור לשידור אמיתי" subtitle="דורש שידור חי פעיל — בודק את ה-handshake מול Cloudflare ואת זרימת המדיה בפועל">
        {rows.length > 0 ? (
          <div className="space-y-2">
            {rows.map((r) => (
              <div key={r.id} className="flex items-center gap-2 flex-wrap">
                <button onClick={() => runWhep(r.cf_customer_code, r.video_id)} disabled={!!busy || !r.cf_customer_code}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-50 transition-colors">
                  בדוק
                </button>
                <span dir="ltr" className="font-mono text-xs text-slate-500 dark:text-slate-400 break-all text-left">
                  {r.kind} · {r.video_id?.slice(0, 12)}… · {new Date(r.created_at).toLocaleString("he-IL")}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            אין שידורי Cloudflare במסד. התחילו שידור ורעננו, או הזינו ידנית:
          </p>
        )}

        <div className="flex gap-2 mt-3 flex-wrap">
          <input value={manual.code} onChange={(e) => setManual({ ...manual, code: e.target.value })}
            placeholder="customer code" dir="ltr" className="filter-input text-sm flex-1 min-w-[140px]" />
          <input value={manual.uid} onChange={(e) => setManual({ ...manual, uid: e.target.value })}
            placeholder="video uid" dir="ltr" className="filter-input text-sm flex-1 min-w-[140px]" />
          <button onClick={() => runWhep(manual.code.trim(), manual.uid.trim())} disabled={!!busy}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-brand hover:opacity-90 disabled:opacity-50 transition-opacity">
            {busy === "whep" ? "מתחבר…" : "בדוק"}
          </button>
        </div>

        {report.whep && (
          <>
            <Result ok={report.whep.ok && report.whep.receiving} label="WHEP">
              {fmtWhep(report.whep)}
            </Result>
            {/* Offered on failure too — a media-stage failure is precisely when the
                relay re-run is the deciding test. */}
            {report.whep.playUrl && (
              <button
                onClick={() => runWhep(
                  report.whep.playUrl.split("customer-")[1]?.split(".")[0],
                  report.whep.playUrl.split("/").slice(-3, -2)[0],
                  "relay",
                )}
                disabled={!!busy}
                className="mt-2 text-xs font-semibold text-brand hover:underline disabled:opacity-50">
                הרץ שוב דרך relay בלבד ←
              </button>
            )}
          </>
        )}
        {report.whepRelay && (
          <Result ok={report.whepRelay.ok && report.whepRelay.receiving} label="WHEP (relay בלבד)">
            {fmtWhep(report.whepRelay)}
          </Result>
        )}

        {/* Real picture = the least deniable proof the path works end to end. */}
        <video ref={videoRef} autoPlay playsInline muted controls
          className="mt-3 w-full max-w-sm aspect-video bg-black rounded-xl object-contain" />
        {live && (
          <button onClick={stopSession}
            className="mt-2 text-xs font-semibold text-red-600 dark:text-red-400 hover:underline">
            עצור צפייה
          </button>
        )}
      </Section>

      {/* ---- Raw report, for pasting into a bug report ------------------------ */}
      {Object.keys(report).length > 0 && (
        <Section title="דוח גולמי" subtitle="העתיקו ושלחו כדי שנוכל לאבחן מרחוק">
          <button onClick={copyReport}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors">
            {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
            {copied ? "הועתק" : "העתק דוח"}
          </button>
          <pre dir="ltr" className="mt-3 p-3 rounded-lg bg-slate-100 dark:bg-slate-800 text-[11px] overflow-x-auto max-h-80 text-left">
            {JSON.stringify(report, null, 2)}
          </pre>
        </Section>
      )}
    </div>
  )
}

// ---- presentation helpers ---------------------------------------------------

function Section({ title, subtitle, children }) {
  return (
    <div className="card p-4 sm:p-5 space-y-3">
      <div>
        <h2 className="font-bold text-sm text-slate-900 dark:text-white">{title}</h2>
        {subtitle && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  )
}

function Result({ ok, label, children }) {
  return (
    <div className="flex items-start gap-2 text-sm mt-2">
      {ok ? <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
          : <XCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />}
      <div className="min-w-0">
        <span className="font-semibold text-slate-700 dark:text-slate-200">{label}: </span>
        <span className="text-slate-600 dark:text-slate-300 break-words">{children}</span>
      </div>
    </div>
  )
}

const fmtProbe = (p) => {
  if (p.error) return `שגיאה: ${p.error}`
  const types = Object.entries(p.types || {}).map(([k, v]) => `${k}:${v}`).join(" ") || "אין"
  const relay = p.relayTransports?.length ? ` · relay דרך ${p.relayTransports.join(", ")}` : ""
  return `${types}${relay} · ${p.gatherMs}ms ${p.complete ? "(הושלם)" : "(נקטע)"}`
}

const fmtWhep = (w) => {
  if (!w.ok) {
    const where = { "ice-gather": "איסוף ICE", "whep-post": "בקשה ל-Cloudflare", "whep-answer": "תשובת SDP", connect: "חיבור ICE", media: "זרימת מדיה" }[w.stage] || w.stage
    const status = w.whepStatus ? ` (HTTP ${w.whepStatus})` : ""
    // The media stage is the informative one: the route came up and carried nothing.
    if (w.stage === "media") {
      const pair = w.selectedPair ? `${w.selectedPair.local} ← ${w.selectedPair.remote}` : "?"
      return `חובר דרך ${pair} אך לא התקבלה מדיה · DTLS: ${w.connectionState} · ICE: ${w.iceConnectionState}`
    }
    return `נכשל בשלב ${where}${status} — ${w.error}`
  }
  const pair = w.selectedPair ? `${w.selectedPair.local} ← ${w.selectedPair.remote}` : "?"
  const bytes = w.inbound?.video?.bytes ?? 0
  const frames = w.inbound?.video?.frames ?? 0
  return `חובר ב-${w.connectMs}ms דרך ${pair} · וידאו: ${bytes} bytes, ${frames} frames ${bytes > 0 ? "✓" : "(לא התקבלה מדיה)"}`
}

// Turns the raw legs into the single sentence an admin actually needs.
function buildVerdict(r) {
  if (!r.turnCreds && !r.whep) return null
  if (r.turnCreds && !r.turnCreds.ok) {
    return { ok: false, title: "המכשיר לא מצליח לשלוף פרטי TURN", detail: `הנגן יורד ל-STUN בלבד ולכן ייכשל בכל רשת מוגבלת. שגיאה: ${r.turnCreds.error}` }
  }
  if (r.turnCreds && !r.turnCreds.hasTurn) {
    return { ok: false, title: "turn-creds החזיר STUN בלבד", detail: "בדקו שה-secrets ‏CF_TURN_KEY_ID ו-CF_TURN_API_TOKEN מוגדרים ותקפים." }
  }
  if (r.iceRelay && !r.iceRelay.types?.relay) {
    return { ok: false, title: "הרשת הזו חוסמת את שרתי ה-TURN", detail: "לא נאסף אף מועמד relay. סביר שיציאות 3478/5349 חסומות — צפייה מרשת כזו לא תעבוד עד שנוסיף relay על 443." }
  }
  // The relay re-run is what separates "this route is dead" from "nothing works".
  if (r.whepRelay && !r.whepRelay.ok && r.whepRelay.stage === "media") {
    return { ok: false, title: "גם relay בלבד לא מקבל מדיה", detail: `החיבור קם דרך TURN ובכל זאת 0 bytes. הבעיה אינה בבחירת המסלול — חשד ל-DTLS או לצד המשדר. DTLS: ${r.whepRelay.connectionState}.` }
  }
  if (r.whepRelay?.ok) {
    return { ok: true, title: "relay בלבד עובד — המסלול הישיר הוא הבעיה", detail: "ICE בחר מסלול ישיר שעובר בדיקות אך לא מעביר מדיה. הנגן מסלים ל-relay אוטומטית אחרי כישלון כזה." }
  }
  if (r.whep && !r.whep.ok) {
    if (r.whep.stage === "whep-post" && r.whep.whepStatus === 409) {
      return { ok: false, title: "אין שידור חי כרגע", detail: "Cloudflare מחזיר 409 — לא הגיעה מדיה לשידור הזה. בדקו מול שידור פעיל." }
    }
    if (r.whep.stage === "whep-post") {
      return { ok: false, title: "הבקשה ל-Cloudflare נחסמה", detail: "לא ICE — הבקשה עצמה נכשלה. חשד ל-CORS, DNS או proxy שמפרק TLS ברשת הזו." }
    }
    if (r.whep.stage === "media") {
      const pair = r.whep.selectedPair?.local || "?"
      return { ok: false, title: "החיבור קם אבל לא זרמה מדיה", detail: `ICE בחר ${pair} ואפס bytes התקבלו — המסלול עובר בדיקות STUN אך לא מעביר RTP. הריצו שוב דרך relay בלבד כדי לאשר.` }
    }
    return { ok: false, title: "ICE נכשל למרות ש-TURN זמין", detail: "ה-relay נאסף אבל החיבור לא קם. הריצו שוב במצב relay בלבד כדי לבודד." }
  }
  if (r.whep?.ok) {
    return { ok: true, title: "הצפייה עובדת מהמכשיר הזה", detail: `מדיה מתקבלת דרך ${r.whep.selectedPair?.local || "?"}.` }
  }
  if (r.iceRelay?.types?.relay) {
    return { ok: true, title: "הרשת תקינה ל-TURN", detail: "נאספו מועמדי relay. המשיכו לשלב 2 מול שידור חי כדי לאמת את כל המסלול." }
  }
  return null
}
