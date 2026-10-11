/**
 * The smallest .xlsx writer that does what the game-form export needs: serialize a
 * worksheet row model back to sheet1.xml, and pack it with the baked template parts
 * into a zip.
 *
 * Deliberately dependency-free. The alternatives (exceljs, sheetjs) are ~1MB to do a
 * job that is two files of string building here, and both would round-trip the
 * template's styling through their own object model — the one thing this export
 * cannot afford, since "identical to the form we sent" IS the requirement.
 *
 * Entries are STORED, not deflated. It costs ~60kB per file (nobody notices on a
 * download) and buys a writer with no compressor in it. Every zip reader in the
 * OOXML world handles method 0 — it is the same thing `zip -0` produces.
 */

// ---- XML ----
// Excel rejects a file containing raw control characters, and a player name pasted
// from elsewhere can carry them. Strip, then escape.
const ILLEGAL = /[\x00-\x08\x0B\x0C\x0E-\x1F]/g
export function esc(s) {
  return String(s).replace(ILLEGAL, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** One `<c>` element. Inline strings only — the baked template has no string table. */
function cellXml(rowNum, cell) {
  const ref = `${cell.c}${rowNum}`
  const s = cell.s != null ? ` s="${cell.s}"` : ''
  if (cell.str != null && cell.str !== '') {
    return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(cell.str)}</t></is></c>`
  }
  if (cell.num != null) return `<c r="${ref}"${s}><v>${cell.num}</v></c>`
  return `<c r="${ref}"${s}/>`
}

/**
 * Serialize a sheet model (the baked SHEET, after the filler has edited it) to
 * sheet1.xml. Row numbers come from each row's `r`, so inserting rows is just
 * splicing the array and renumbering — no string surgery.
 */
export function sheetXml(sheet) {
  const rows = sheet.rows.map(row => {
    const ht = row.ht != null ? ` ht="${row.ht}" customHeight="1"` : ''
    const cells = row.cells.map(c => cellXml(row.r, c)).join('')
    return cells ? `<row r="${row.r}"${ht}>${cells}</row>` : `<row r="${row.r}"${ht}/>`
  }).join('')
  const merges = sheet.merges.length
    ? `<mergeCells count="${sheet.merges.length}">${sheet.merges.map(m => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>`
    : ''
  return sheet.docOpen + sheet.sheetPr + sheet.sheetViews + sheet.sheetFormatPr + sheet.cols +
    `<sheetData>${rows}</sheetData>` + merges + sheet.afterMerges
}

// ---- zip ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[i] = c >>> 0
  }
  return t
})()

function crc32(bytes) {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

// A fixed DOS timestamp (2020-01-01 00:00) keeps output byte-identical across runs,
// which is what makes "same input → same file" testable.
const DOS_TIME = 0
const DOS_DATE = ((2020 - 1980) << 9) | (1 << 5) | 1

/**
 * Pack `{ [path]: string | Uint8Array }` into a zip. Returns a Uint8Array — hand it to
 * a Blob. Paths must use forward slashes; string contents are encoded UTF-8, bytes
 * (the signature PNGs) go in as they are.
 */
export function zip(files) {
  const enc = new TextEncoder()
  const entries = Object.entries(files).map(([name, body]) => ({
    name: enc.encode(name),
    data: body instanceof Uint8Array ? body : enc.encode(body),
  }))
  for (const e of entries) e.crc = crc32(e.data)

  const LOCAL = 30, CENTRAL = 46, EOCD = 22
  const localSize = entries.reduce((n, e) => n + LOCAL + e.name.length + e.data.length, 0)
  const centralSize = entries.reduce((n, e) => n + CENTRAL + e.name.length, 0)
  const out = new Uint8Array(localSize + centralSize + EOCD)
  const view = new DataView(out.buffer)
  const u32 = (p, v) => view.setUint32(p, v, true)
  const u16 = (p, v) => view.setUint16(p, v, true)

  let p = 0
  for (const e of entries) {
    e.offset = p
    u32(p, 0x04034b50)        // local file header
    u16(p + 4, 20)            // version needed
    u16(p + 6, 0x0800)        // flags: bit 11 = UTF-8 names
    u16(p + 8, 0)             // method 0 = stored
    u16(p + 10, DOS_TIME); u16(p + 12, DOS_DATE)
    u32(p + 14, e.crc)
    u32(p + 18, e.data.length); u32(p + 22, e.data.length)
    u16(p + 26, e.name.length); u16(p + 28, 0)
    p += LOCAL
    out.set(e.name, p); p += e.name.length
    out.set(e.data, p); p += e.data.length
  }

  const centralStart = p
  for (const e of entries) {
    u32(p, 0x02014b50)        // central directory header
    u16(p + 4, 20); u16(p + 6, 20)
    u16(p + 8, 0x0800); u16(p + 10, 0)
    u16(p + 12, DOS_TIME); u16(p + 14, DOS_DATE)
    u32(p + 16, e.crc)
    u32(p + 20, e.data.length); u32(p + 24, e.data.length)
    u16(p + 28, e.name.length); u16(p + 30, 0); u16(p + 32, 0)
    u16(p + 34, 0); u16(p + 36, 0); u32(p + 38, 0)
    u32(p + 42, e.offset)
    p += CENTRAL
    out.set(e.name, p); p += e.name.length
  }

  u32(p, 0x06054b50)          // end of central directory
  u16(p + 8, entries.length); u16(p + 10, entries.length)
  u32(p + 12, p - centralStart); u32(p + 16, centralStart)
  return out
}
