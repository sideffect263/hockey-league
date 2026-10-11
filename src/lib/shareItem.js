import { trackAction } from './telemetry'

/**
 * Open the platform share sheet for a buildShare() target; where there is none (most
 * desktop browsers), copy the link and say so. Logs telemetry `share` {type} either way
 * (only the card type — never the text, which can carry names).
 */
export async function shareTarget(target) {
  if (!target?.url) return
  trackAction('share', { type: target.type })
  if (typeof navigator !== 'undefined' && navigator.share) {
    try {
      await navigator.share({ title: target.title, text: target.text, url: target.url })
      return
    } catch (e) {
      if (e?.name === 'AbortError') return // the person closed the sheet
    }
  }
  try {
    await navigator.clipboard.writeText(target.url)
    toast('הקישור הועתק')
  } catch {
    toast('לא ניתן להעתיק את הקישור')
  }
}

/** A tiny self-contained toast (the app has no toast system). */
export function toast(message, ms = 2200) {
  if (typeof document === 'undefined') return
  const el = document.createElement('div')
  el.setAttribute('role', 'status')
  el.dir = 'rtl'
  el.textContent = message
  el.className = 'fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] px-4 py-2 rounded-full bg-slate-900 text-white text-sm font-semibold shadow-lg dark:bg-white dark:text-slate-900 transition-opacity duration-300'
  document.body.appendChild(el)
  setTimeout(() => { el.style.opacity = '0' }, ms - 300)
  setTimeout(() => el.remove(), ms)
}
