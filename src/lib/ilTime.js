/**
 * Game times are Israel times. A phone abroad (or set to the wrong zone) must still
 * see 20:00, not 13:00 — date-fns `format` renders in the browser's zone, so hand it
 * a Date whose local fields are the Israel wall clock instead.
 *
 * Display only: the returned Date is shifted, so never compare it with `new Date()`.
 */
export const IL_TZ = 'Asia/Jerusalem'

const parts = new Intl.DateTimeFormat('en-US', {
  timeZone: IL_TZ, hourCycle: 'h23',
  year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
})

export function ilDate(value) {
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return d
  const p = Object.fromEntries(parts.formatToParts(d).map(x => [x.type, x.value]))
  return new Date(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second, d.getMilliseconds())
}
