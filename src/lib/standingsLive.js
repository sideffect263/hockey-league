// Live "איפה אנחנו עומדים" tables: the static standings in pipelineMap.js are the measured history; finished
// experiments (dev_experiments) keep them current.
//   • the row marked `current` (today's default) takes the baseline the worker re-measures on EVERY run —
//     so the numbers follow the review truth as people review more events;
//   • a row with a `key` takes the newest finished experiment that tested exactly that model set with
//     default thresholds;
//   • every experiment an admin marked "promoted" that no row covers gets its own row.
// Ball keys: "<detectors joined by +>__<checker>" (same as video-analysis/devlab/engine_ball.py).

import { paramByKey } from './experimentSpec'

const BALL_SET_ONLY = new Set(['detectors', 'checker', 'engine_test'])
const DEF_DETECTORS = ['black', 'black_r3', 'r7']
const ballKey = (p = {}) => `${(p.detectors || DEF_DETECTORS).join('+')}__${p.checker || 'v7'}`
const day = (iso) => { try { return new Date(iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' }) } catch { return '' } }
const f3 = (x) => (x == null ? '—' : Number(x).toFixed(3))

/** Newest engine baseline (today's engine on all reviews) from either stage. */
function engineBaseline(exps) {
  for (const e of exps) {                       // sorted newest first
    if (e.stage === 'events' && e.baseline?.f1 != null) return { m: e.baseline, at: e.finished_at }
    if (e.stage === 'ball' && e.engine?.baseline?.f1 != null) return { m: e.engine.baseline, at: e.finished_at }
  }
  return null
}

export function liveStandings(st, exps) {
  if (!st?.live || !exps?.length) return st
  const rows = st.rows.map(r => ({ ...r, cells: [...r.cells] }))
  const eng = engineBaseline(exps)
  let latest = null

  if (st.live === 'ball') {
    const balls = exps.filter(e => e.stage === 'ball')
    const base = balls.find(e => e.baseline?.found != null)
    const cur = rows.find(r => r.current)
    if (cur && base) { cur.cells[1] = String(base.baseline.found); cur.cells[2] = String(base.baseline.false); latest = base.finished_at }
    if (cur && eng) { cur.cells[3] = f3(eng.m.f1); if (!latest || eng.at > latest) latest = eng.at }
    for (const r of rows.filter(r => r.key && !r.current)) {
      const e = balls.find(x => ballKey(x.params) === r.key && Object.keys(x.params || {}).every(k => BALL_SET_ONLY.has(k)))
      if (!e) continue
      r.cells[1] = String(e.metrics.found); r.cells[2] = String(e.metrics.false)
      if (e.engine?.metrics?.f1 != null) r.cells[3] = f3(e.engine.metrics.f1)
      if (e.decision === 'promoted') r.promoted = true
    }
    const covered = new Set(rows.map(r => r.key).filter(Boolean))
    for (const e of balls.filter(x => x.decision === 'promoted')) {
      const k = ballKey(e.params)
      const onlySet = Object.keys(e.params || {}).every(x => BALL_SET_ONLY.has(x))
      if (onlySet && covered.has(k)) continue
      covered.add(k)
      rows.push({ promoted: true, cells: [[(e.params?.detectors || DEF_DETECTORS).join(' + '),
        `בודק ${e.params?.checker || 'v7'}${onlySet ? '' : ' · ספים אחרים'} · נבחר ${day(e.decided_at)}`],
        String(e.metrics.found), String(e.metrics.false), f3(e.engine?.metrics?.f1)] })
    }
  }

  if (st.live === 'events') {
    const cur = rows.find(r => r.current)
    if (cur && eng) { cur.cells[3] = f3(eng.m.f1); latest = eng.at }
    for (const e of exps.filter(x => x.stage === 'events' && x.decision === 'promoted')) {
      const what = Object.entries(e.params || {}).map(([k, v]) => `${paramByKey('events', k)?.label || k}: ${typeof v === 'boolean' ? (v ? 'פעיל' : 'כבוי') : v}`).join(' · ')
      rows.push({ promoted: true, cells: [[e.title, `נבחר ${day(e.decided_at)}`], what || 'ברירת המחדל', '—', f3(e.metrics?.f1)] })
    }
  }

  const truthN = eng?.m?.truth_events
  return {
    ...st, rows,
    liveNote: latest ? `מתעדכן אוטומטית מהניסויים · עדכון אחרון ${day(latest)}${truthN ? ` · ${truthN} אירועים שנסקרו` : ''}` : null,
  }
}
