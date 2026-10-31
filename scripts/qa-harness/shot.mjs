// Headless screenshots for Floodlight QA, so parallel helpers don't fight over one browser.
//   node scripts/qa-harness/shot.mjs <url> <out.png> [--w 390] [--h 844] [--dark] [--full] [--scroll N] [--wait ms]
// Phone = 390x844 @2x; desktop = --w 1440 --h 900. --dark sets prefers-color-scheme: dark.
// Prints console errors and failed requests so a broken page is not mistaken for a design.
import puppeteer from 'puppeteer'

const [url, out, ...rest] = process.argv.slice(2)
const opt = (k, d) => { const i = rest.indexOf(k); return i >= 0 ? rest[i + 1] : d }
const flag = (k) => rest.includes(k)
const w = +opt('--w', 390), h = +opt('--h', 844)
const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] })
const page = await browser.newPage()
await page.setViewport({ width: w, height: h, deviceScaleFactor: w < 768 ? 2 : 1, isMobile: w < 768, hasTouch: w < 768 })
await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: flag('--dark') ? 'dark' : 'light' }])
await page.evaluateOnNewDocument((dark) => { try { localStorage.setItem('hockey-theme', dark ? 'dark' : 'light') } catch {} }, flag('--dark'))
page.on('console', (m) => { if (m.type() === 'error') console.log('console.error:', m.text().slice(0, 300)) })
page.on('pageerror', (e) => console.log('pageerror:', String(e).slice(0, 300)))
page.on('requestfailed', (r) => console.log('requestfailed:', r.url().slice(0, 160)))
await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 }).catch((e) => console.log('goto:', e.message))
await new Promise((r) => setTimeout(r, +opt('--wait', 1200)))
const sc = +opt('--scroll', 0)
if (sc) { await page.evaluate((y) => window.scrollTo(0, y), sc); await new Promise((r) => setTimeout(r, 500)) }
// Horizontal overflow is a bug on phones (RTL pages that scroll sideways).
// Measured on elements, not scrollWidth: mobile emulation widens the layout viewport to fit
// an overflowing child, so scrollWidth == innerWidth even when the page scrolls sideways.
const ow = await page.evaluate((W) => {
  const bad = []
  document.querySelectorAll('body *').forEach((e) => {
    const r = e.getBoundingClientRect()
    if (!r.width || (r.right <= W + 1 && r.left >= -1) || getComputedStyle(e).position === 'fixed') return
    // Inside a clipping/scrolling box (carousel, table scroller): not a page overflow.
    for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) {
      const cs = getComputedStyle(a)
      if (cs.overflowX !== 'visible' || cs.position === 'fixed') return
    }
    bad.push(`${e.tagName}.${String(e.className).slice(0, 70)} [${Math.round(r.left)}..${Math.round(r.right)}]`)
  })
  return bad
}, w)
const real = ow
if (real.length) console.log(`WARN horizontal overflow: ${real.length} elements, e.g. ${real[0]}`)
await page.screenshot({ path: out, fullPage: flag('--full') })
console.log('saved', out)
await browser.close()
