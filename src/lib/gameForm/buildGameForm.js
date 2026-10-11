import { FILES, SHEET } from './template'
import { sheetXml, zip } from './xlsx'

/**
 * Fill the league's blank refereeing form with a played game and return it as .xlsx
 * bytes — the same sheet the judge fills by hand, printed out already knowing what
 * happened.
 *
 * The form is a fixed drawing: two team blocks of ten player rows each, a fouls grid
 * and a timeout box down the right of each, then results at the bottom. We only ever
 * WRITE INTO cells the form already has, so every value inherits the border, font and
 * fill the original was drawn with. Two things are structural rather than cosmetic:
 *
 *  - A squad can exceed the ten printed rows, so the player block grows. New rows are
 *    spliced in just BEFORE the block's closing row (which carries the bottom border)
 *    and their U:Y cells are left out entirely — that region is the timeout box, and
 *    empty rows there read as space between the two halves rather than a torn grid.
 *  - The medic section the form has no room for is appended after the last row, built
 *    from the results section's own title/label/value rows so it looks native.
 *
 * Team fouls are crossed off the printed 1–25 grid, timeouts go in as the minute of
 * the half, and the digital signatures are placed as pictures over their signature
 * lines (a drawing part the blank already links, so only its anchors are new).
 * Anything the app does not know stays exactly as printed, for the pen.
 */

// Rows of the blank form. `first`/`last` bracket the printed player rows; `last` is
// the one with the closing border, so growth is inserted before it.
// `fouls` = first row of the 1–25 fouls grid; `timeouts` = the value rows under each
// half's "דקה | דקה" labels (two timeouts per half).
const HOME = { teamName: 9, first: 11, last: 20, coach: 21, foulsTitle: 8, foulsTotal: 9, fouls: 10, timeouts: [19, 22] }
const AWAY = { teamName: 25, first: 27, last: 36, coach: 37, foulsTitle: 24, foulsTotal: 25, fouls: 26, timeouts: [35, 38] }
const RESULTS = { title: 40, labels: 41, values: 42, entries: 43, notesLine: 44 }
const PRINTED_ROWS = HOME.last - HOME.first + 1

const GOAL_COLS = ['G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P']  // one cell per goal
const BLUE_COLS = ['Q', 'R', 'S']                                     // one cell per blue card
const RED_COL = 'T'
const SIDE_COLS = ['U', 'V', 'W', 'X', 'Y']                           // fouls grid + timeout box
// The grid prints 5,4,3,2,1 in U..Y, so foul n sits in column FOUL_COLS[(n-1) % 5].
const FOUL_COLS = ['Y', 'X', 'W', 'V', 'U']
const FOUL_GRID_MAX = 25
const TIMEOUT_COLS = ['U', 'X']
const MARK = '1'   // the form's own instruction: "יש לסמן V או 1 בכל הבקעה"
const GK_SUFFIX = ' (שוער/ת)'
const BLANK_LINE = '___________'   // what the form prints wherever a name is written in

// Beyond this a note stops fitting the box beside חתימת שופט and moves to the wide line below.
const NOTE_INLINE_MAX = 32

// ---- sheet model editing ----
const cloneSheet = (s) => ({
  ...s,
  merges: [...s.merges],
  rows: s.rows.map(r => ({ ...r, cells: r.cells.map(c => ({ ...c })) })),
})

const rowAt = (sheet, r) => sheet.rows.find(row => row.r === r)

/**
 * Write a value into an existing cell, keeping its style. Unknown cells are ignored,
 * and so is an empty value — the form prints "________" wherever something gets
 * written by hand, and erasing that because the database happens not to know the
 * referee (or the shirt number, or the half-time score) would hand back a form with
 * nowhere to write it.
 */
function setCell(sheet, r, col, value) {
  if (value == null || value === '') return
  const cell = rowAt(sheet, r)?.cells.find(c => c.c === col)
  if (!cell) return
  delete cell.str; delete cell.num
  if (typeof value === 'number' && Number.isFinite(value)) cell.num = value
  else cell.str = String(value)
}

const parseRef = (ref) => {
  const [a, b] = ref.split(':')
  const m1 = /^([A-Z]+)(\d+)$/.exec(a), m2 = /^([A-Z]+)(\d+)$/.exec(b)
  return { c1: m1[1], r1: +m1[2], c2: m2[1], r2: +m2[2] }
}

/** Merges that begin and end on one row — the ones worth replicating onto a clone. */
const mergesOnRow = (sheet, r) => sheet.merges.map(parseRef).filter(m => m.r1 === r && m.r2 === r)

/**
 * Splice rows in before `beforeRow`, each cloning the styles (never the text) of a
 * source row, and push everything below down — cells, row heights and merges alike.
 * Every source row must sit ABOVE the insertion point so its own number is stable.
 */
function insertRows(sheet, beforeRow, sources, { drop = [] } = {}) {
  if (!sources.length) return
  const n = sources.length
  const templates = sources.map(r => {
    const row = rowAt(sheet, r)
    if (!row) throw new Error(`insertRows: no source row ${r}`)
    if (r >= beforeRow) throw new Error(`insertRows: source row ${r} is not above ${beforeRow}`)
    return row
  })
  const rowMerges = sources.map(r => mergesOnRow(sheet, r))

  for (const row of sheet.rows) if (row.r >= beforeRow) row.r += n
  sheet.merges = sheet.merges.map(ref => {
    const m = parseRef(ref)
    // A merge that straddles the insertion point stretches; one entirely below moves.
    const r1 = m.r1 >= beforeRow ? m.r1 + n : m.r1
    const r2 = m.r2 >= beforeRow ? m.r2 + n : m.r2
    return `${m.c1}${r1}:${m.c2}${r2}`
  })

  templates.forEach((tpl, i) => {
    const r = beforeRow + i
    sheet.rows.push({
      r,
      ...(tpl.ht != null ? { ht: tpl.ht } : {}),
      cells: tpl.cells.filter(c => !drop.includes(c.c)).map(c => ({ c: c.c, s: c.s })),
    })
    for (const m of rowMerges[i]) {
      if (drop.includes(m.c1)) continue
      sheet.merges.push(`${m.c1}${r}:${m.c2}${r}`)
    }
  })
  sheet.rows.sort((a, b) => a.r - b.r)
}

// ---- filling ----
/**
 * `keepsLabel` is true while the block's first row still shows its printed "שוער/ת" —
 * writing a shirt number into that cell overwrites the hint, so the keeper gets marked
 * on the name instead. Only one of the two ever shows.
 */
function fillPlayerRow(sheet, r, player, keepsLabel) {
  setCell(sheet, r, 'A', Number.isFinite(player.number) ? player.number : null)
  const marked = player.isGoalkeeper && !keepsLabel
  setCell(sheet, r, 'B', marked ? `${player.name}${GK_SUFFIX}` : player.name)
  for (let i = 0; i < Math.min(player.goals || 0, GOAL_COLS.length); i++) setCell(sheet, r, GOAL_COLS[i], MARK)
  for (let i = 0; i < Math.min(player.blue || 0, BLUE_COLS.length); i++) setCell(sheet, r, BLUE_COLS[i], MARK)
  if (player.red > 0) setCell(sheet, r, RED_COL, MARK)
}

function fillTeamBlock(sheet, block, team, at) {
  setCell(sheet, at(block.teamName), 'A', team.name)
  team.players.forEach((p, i) => {
    // Most players have no shirt number on record, so the first row usually keeps its
    // printed "שוער/ת" rather than being overwritten with one.
    const keepsLabel = i === 0 && !Number.isFinite(p.number)
    fillPlayerRow(sheet, at(block.first) + i, p, keepsLabel)
  })
  setCell(sheet, at(block.coach), 'E', team.coach)
  setCell(sheet, at(block.coach), 'N', team.captain)

  // Fouls: cross off 1..n on the grid, the way the judge does it by pen, and write the
  // total into the caption so nobody has to count the crosses.
  if (Number.isFinite(team.fouls)) {
    for (let n = 1; n <= Math.min(team.fouls, FOUL_GRID_MAX); n++) {
      setCell(sheet, at(block.fouls) + Math.floor((n - 1) / 5), FOUL_COLS[(n - 1) % 5], 'X')
    }
    setCell(sheet, at(block.foulsTitle), 'U', 'עבירות קבוצתיות:')
    setCell(sheet, at(block.foulsTotal), 'U', team.fouls)
  }
  // Timeouts: the minute of the half each was called in, two boxes per half.
  ;[team.timeouts?.first, team.timeouts?.second].forEach((mins, h) => {
    (mins || []).slice(0, TIMEOUT_COLS.length).forEach((m, i) => {
      setCell(sheet, at(block.timeouts[h]), TIMEOUT_COLS[i], Number.isFinite(m) ? m : 'V')
    })
  })
}

/**
 * The medic block the blank form lacks, appended in the results section's own idiom —
 * its title, label and value rows cloned, so it carries the same borders and weights.
 * The clones come through with styles only, hence no need to clear the cloned text.
 */
function appendMedicSection(sheet, medicName, at) {
  const after = sheet.rows[sheet.rows.length - 1].r + 1
  insertRows(sheet, after, [RESULTS.title, RESULTS.labels, RESULTS.values].map(at))
  setCell(sheet, after, 'A', 'חובש')
  setCell(sheet, after + 1, 'A', 'שם החובש')
  setCell(sheet, after + 1, 'G', 'חתימת חובש')
  setCell(sheet, after + 2, 'A', medicName || BLANK_LINE)
  setCell(sheet, after + 2, 'G', 'X _______________')
  return after + 2
}

// ---- signature pictures ----
const EMU_PER_PX = 9525
const SIG_MAX_W = 120, SIG_MAX_H = 34   // px — fits one printed line without hiding the next
const colIndex = (col) => [...col].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1

function dataUrlBytes(url) {
  const m = /^data:image\/png;base64,(.+)$/.exec(url || '')
  if (!m) return null
  const bin = atob(m[1])
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** PNG pixel size from its IHDR chunk (bytes 16..23, big-endian). */
function pngSize(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return { w: v.getUint32(16), h: v.getUint32(20) }
}

/**
 * Place each signature as a picture anchored on its line. Returns the extra package
 * parts: the PNGs, the drawing's rels, and the drawing + content types rewritten.
 */
function signatureParts(placements) {
  const pics = placements.map(p => ({ ...p, bytes: dataUrlBytes(p.image) })).filter(p => p.bytes && p.bytes.length > 24)
  if (!pics.length) return {}
  const parts = {}
  const rels = []
  const anchors = pics.map((p, i) => {
    const rid = `rId${i + 1}`
    parts[`xl/media/signature${i + 1}.png`] = p.bytes
    rels.push(`<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/signature${i + 1}.png"/>`)
    const { w, h } = pngSize(p.bytes)
    const scale = Math.min(SIG_MAX_W / w, SIG_MAX_H / h)
    const cx = Math.round(w * scale * EMU_PER_PX), cy = Math.round(h * scale * EMU_PER_PX)
    return `<xdr:oneCellAnchor><xdr:from><xdr:col>${colIndex(p.col)}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${p.row - 1}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>`
      + `<xdr:ext cx="${cx}" cy="${cy}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${i + 2}" name="${p.name}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>`
      + `<xdr:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>`
      + `<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>`
  })
  // The blank's drawing part is an empty, self-closed <xdr:wsDr …/>.
  parts['xl/drawings/drawing1.xml'] = FILES['xl/drawings/drawing1.xml'].replace(/\/>\s*$/, `>${anchors.join('')}</xdr:wsDr>`)
  parts['xl/drawings/_rels/drawing1.xml.rels'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`
  parts['[Content_Types].xml'] = FILES['[Content_Types].xml'].replace('<Default ', '<Default ContentType="image/png" Extension="png"/><Default ')
  return parts
}

/**
 * Build the filled form. `report` is what `lib/gameReport.js` assembles plus whatever
 * the export dialog collected; every field is optional and an absent one simply leaves
 * the printed blank in place.
 */
export function buildGameForm(report) {
  const sheet = cloneSheet(SHEET)
  const homeExtra = Math.max(0, (report.home?.players?.length || 0) - PRINTED_ROWS)
  const awayExtra = Math.max(0, (report.away?.players?.length || 0) - PRINTED_ROWS)

  // Grow both blocks before writing anything, bottom-up so the row numbers we clone
  // from stay valid. `drop` keeps the fouls/timeout column out of the new rows.
  insertRows(sheet, AWAY.last, Array(awayExtra).fill(AWAY.last - 1), { drop: SIDE_COLS })
  insertRows(sheet, HOME.last, Array(homeExtra).fill(HOME.last - 1), { drop: SIDE_COLS })

  // Original row number → its number in the grown sheet.
  const at = (r) => r + (r >= HOME.last ? homeExtra : 0) + (r >= AWAY.last ? awayExtra : 0)

  // Header
  setCell(sheet, 3, 'D', report.date)
  setCell(sheet, 3, 'G', report.day)
  setCell(sheet, 3, 'L', report.venue)
  setCell(sheet, 3, 'Q', report.time)
  setCell(sheet, 3, 'U', report.referee)
  setCell(sheet, 5, 'A', report.competition)
  setCell(sheet, 5, 'G', report.ageLabel)
  setCell(sheet, 5, 'M', report.gameCode)
  // One box serves both שופט נוסף and צופה שופטים in the original drawing.
  setCell(sheet, 5, 'U', [report.extraReferee, report.observer].filter(Boolean).join(' / '))

  if (report.home) fillTeamBlock(sheet, HOME, report.home, at)
  if (report.away) fillTeamBlock(sheet, AWAY, report.away, at)

  // Results. Home and away sit in separate cells either side of the printed "/", so
  // there is no bidi mixing — the RTL sheet already puts column A on the right, under
  // the מארחת / אורחת caption.
  const entries = at(RESULTS.entries)
  setCell(sheet, entries, 'A', report.halftimeHome)
  setCell(sheet, entries, 'F', report.halftimeAway)
  setCell(sheet, entries, 'G', report.finalHome)
  setCell(sheet, entries, 'M', report.finalAway)

  const note = (report.refereeNotes || '').trim()
  setCell(sheet, entries, 'Q', note && note.length <= NOTE_INLINE_MAX ? `הערות שופט: ${note}` : 'הערות שופט:')
  if (note.length > NOTE_INLINE_MAX) setCell(sheet, at(RESULTS.notesLine), 'A', note)

  const medicSigRow = appendMedicSection(sheet, report.medic, at)

  const sig = report.signatures || {}
  const sigParts = signatureParts([
    { name: 'חתימת שופט', image: sig.referee, row: at(RESULTS.values), col: 'R' },
    { name: 'חתימת מאמן מארחת', image: sig.home_coach, row: at(HOME.coach), col: 'G' },
    { name: 'חתימת קפטן מארחת', image: sig.home_captain, row: at(HOME.coach), col: 'R' },
    { name: 'חתימת מאמן אורחת', image: sig.away_coach, row: at(AWAY.coach), col: 'G' },
    { name: 'חתימת קפטן אורחת', image: sig.away_captain, row: at(AWAY.coach), col: 'R' },
    { name: 'חתימת חובש', image: sig.medic, row: medicSigRow, col: 'H' },
  ])

  return zip({ ...FILES, 'xl/worksheets/sheet1.xml': sheetXml(sheet), ...sigParts })
}
