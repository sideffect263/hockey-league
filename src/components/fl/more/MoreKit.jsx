/**
 * Floodlight pieces shared by the "more" area (סטופר מרקט, loans, media, search, status
 * screens). Prefixed `More…` so they cannot clash with another area's kit at merge time.
 */
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { BrandIcon } from '@/components/icons/BrandIcons'
import './more.css'

/** The סטופר coin (brand-icons coin-small / coin-large by size). */
export function MoreCoin({ size = 20, className = '' }) {
  return <BrandIcon name="coin" size={size} variant={size >= 32 ? 'large' : 'small'} className={className} />
}

/**
 * Pill tabs (boards: PredictHome, MediaLibrary): 44px pills, ink when selected, card
 * otherwise. `tabs` = [{ key, label, n? }]. Scrolls sideways on a narrow phone.
 */
export function MorePillTabs({ tabs, value, onChange, label, className = '' }) {
  return (
    <div role="tablist" aria-label={label} className={`flex gap-2 overflow-x-auto no-scrollbar ${className}`}>
      {tabs.map(t => {
        const on = t.key === value
        return (
          <button key={t.key} type="button" role="tab" aria-selected={on} onClick={() => onChange(t.key)}
            className={`shrink-0 h-11 px-[18px] rounded-full text-sm inline-flex items-center gap-2 transition-colors ${
              on ? 'bg-brand text-brand-fg font-bold' : 'bg-surface text-fg-strong font-semibold hover:bg-surface-inset'
            }`}>
            {t.label}
            {t.n != null && <span className={`fl-num text-[12px] ${on ? 'opacity-70' : 'text-fg-muted'}`}>{t.n}</span>}
          </button>
        )
      })}
    </div>
  )
}

/** Filter chip row (smaller than tabs, 36px; still ≥44px hit area via padding on the row). */
export function MoreChip({ on, onClick, children, n }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      className={`shrink-0 h-9 px-3.5 rounded-full text-[13px] font-bold inline-flex items-center gap-1.5 transition-colors ${
        on ? 'bg-brand text-brand-fg' : 'bg-surface text-fg-muted hover:text-fg-strong'
      }`}>
      {children}
      {n != null && <span className={`fl-num text-[11px] ${on ? 'opacity-70' : ''}`}>{n}</span>}
    </button>
  )
}

/** Section title row: 21px/800 title, optional quiet note on the far side. */
export function MoreSectionHead({ title, note, action, className = '' }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 px-1.5 pb-2.5 ${className}`}>
      <h2 className="text-[21px] font-extrabold leading-tight text-fg-strong">{title}</h2>
      {action || (note && <span className="text-[12.5px] text-fg-muted text-end">{note}</span>)}
    </div>
  )
}

/** Quiet empty state: why + (optional) action. */
export function MoreEmpty({ icon = 'history', title, text, action }) {
  return (
    <div className="fl-card px-6 py-9 text-center">
      <BrandIcon name={icon} variant="large" className="w-12 h-12 mx-auto mb-3 opacity-90" />
      {title && <p className="font-extrabold text-fg-strong">{title}</p>}
      {text && <p className="text-[13px] text-fg-muted mt-1 max-w-sm mx-auto leading-relaxed">{text}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  )
}

/**
 * Bottom sheet for phones (PredictSheet board): dim backdrop, paper sheet with a grab
 * handle, Esc / backdrop closes, focus moves into the sheet and back on close.
 */
export function MoreSheet({ open, onClose, label, children }) {
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const prev = document.activeElement
    const onKey = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const t = setTimeout(() => ref.current?.focus(), 30)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      clearTimeout(t)
      document.body.style.overflow = overflow
      prev?.focus?.()
    }
  }, [open, onClose])
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center" role="presentation">
      <div className="absolute inset-0 bg-[rgba(7,11,16,.55)] fl-more-fade-in" onClick={onClose} />
      <section ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={label}
        className="fl-mkt relative w-full max-w-lg max-h-[88vh] overflow-y-auto rounded-t-[28px] bg-surface px-[18px] pt-2.5 pb-[calc(24px+env(safe-area-inset-bottom))] fl-more-sheet-in outline-none">
        <span aria-hidden="true" className="block mx-auto mb-3 w-10 h-[5px] rounded-full bg-line-strong" />
        {children}
      </section>
    </div>,
    document.body,
  )
}
