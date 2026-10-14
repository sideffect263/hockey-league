/**
 * Coarse device sniffing for flows where the platform decides what can work at all
 * (e.g. webcal:// only exists on Apple, Google Calendar's phone apps can't subscribe by URL).
 * UA sniffing is the only signal for these — feature detection can't tell us.
 */

const ua = () => (typeof navigator !== "undefined" ? navigator.userAgent || "" : "")

/** iPhone / iPad / iPod — including iPadOS, which reports itself as a Mac. */
export function isIOS() {
  const u = ua()
  if (/iPhone|iPad|iPod/i.test(u)) return true
  return /Macintosh/.test(u) && typeof navigator !== "undefined" && navigator.maxTouchPoints > 1
}

export function isAndroid() {
  return /Android/i.test(ua())
}

export function isMobile() {
  return isIOS() || isAndroid() || /Mobi/i.test(ua())
}

/**
 * WhatsApp / Instagram / Facebook / Telegram / LINE in-app browsers, and Android WebViews.
 * These block custom URL schemes like webcal:, so a "subscribe" link there is a dead tap.
 */
export function isInAppBrowser() {
  return /WhatsApp|Instagram|FBAN|FBAV|FB_IAB|Line\/|Telegram|; wv\)/i.test(ua())
}
