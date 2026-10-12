import { useEffect, useRef, useState } from "react"
import { X, Eraser, Check } from "lucide-react"

/**
 * Finger/mouse signature pad. Draws black ink on a transparent canvas, so the PNG sits
 * on the printed form's signature line without a white box around it. The pad itself
 * is shown on white in both themes — ink you can't see is ink you can't check.
 *
 * Exported at a fixed 600×180 so a signature is ~10–30 kB however large the screen.
 */
const OUT_W = 600, OUT_H = 180

export default function SignaturePad({ title, onCancel, onSave, saving, offerRemember = false }) {
  const canvasRef = useRef(null)
  const drawing = useRef(false)
  const last = useRef(null)
  const [empty, setEmpty] = useState(true)
  // Offered to signers: keep this signature so next time is one tap ("אישור וחתימה").
  const [remember, setRemember] = useState(true)

  // Size the backing store to the element × devicePixelRatio, so strokes are crisp.
  useEffect(() => {
    const c = canvasRef.current
    const r = c.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr)
    const ctx = c.getContext("2d")
    ctx.scale(dpr, dpr)
    ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.lineWidth = 2.6; ctx.strokeStyle = "#111"
  }, [])

  const point = (e) => {
    const r = canvasRef.current.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const down = (e) => {
    e.preventDefault()
    canvasRef.current.setPointerCapture?.(e.pointerId)
    drawing.current = true
    last.current = point(e)
    const ctx = canvasRef.current.getContext("2d")
    ctx.beginPath(); ctx.arc(last.current.x, last.current.y, 1.2, 0, Math.PI * 2); ctx.fillStyle = "#111"; ctx.fill()
    setEmpty(false)
  }
  const move = (e) => {
    if (!drawing.current) return
    e.preventDefault()
    const p = point(e)
    const ctx = canvasRef.current.getContext("2d")
    ctx.beginPath(); ctx.moveTo(last.current.x, last.current.y); ctx.lineTo(p.x, p.y); ctx.stroke()
    last.current = p
  }
  const up = () => { drawing.current = false }

  const clear = () => {
    const c = canvasRef.current
    c.getContext("2d").clearRect(0, 0, c.width, c.height)
    setEmpty(true)
  }

  const save = () => {
    const src = canvasRef.current
    const out = document.createElement("canvas")
    out.width = OUT_W; out.height = OUT_H
    out.getContext("2d").drawImage(src, 0, 0, OUT_W, OUT_H)
    onSave(out.toDataURL("image/png"), offerRemember && remember)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onCancel}>
      <div className="card w-full max-w-lg p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-slate-900 dark:text-white">{title}</h3>
          <button onClick={onCancel} aria-label="סגור" className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"><X className="w-4 h-4 text-slate-400" /></button>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">חתמו באצבע או בעכבר בתוך המסגרת. החתימה תצורף לטופס השיפוט של המשחק.</p>
        <div className="relative">
          <canvas
            ref={canvasRef}
            onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} onPointerCancel={up}
            className="w-full aspect-[10/3] rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-600 bg-white touch-none cursor-crosshair"
          />
          {empty && <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-slate-300">חתימה</span>}
          <div className="pointer-events-none absolute left-6 right-6 bottom-[22%] border-b border-slate-200" />
        </div>
        {offerRemember && (
          <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="accent-brand" />
            שמור את החתימה לפעמים הבאות — בפעם הבאה רק לוחצים "אישור וחתימה"
          </label>
        )}
        <div className="flex gap-2">
          <button onClick={save} disabled={empty || saving} className="btn-primary flex-1 py-2.5">
            <Check className="w-4 h-4" /> {saving ? "שומר…" : "אישור חתימה"}
          </button>
          <button onClick={clear} disabled={empty || saving} className="btn-secondary px-4 py-2.5">
            <Eraser className="w-4 h-4" /> נקה
          </button>
        </div>
      </div>
    </div>
  )
}
