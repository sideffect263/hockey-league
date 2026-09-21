/**
 * Career-mode QA harness.  `node scripts/check-career.mjs`
 *
 * Plays 576 full careers — every position × every cadence × four play styles —
 * and asserts the invariants that unit tests would miss, because the bugs this
 * engine actually produces are statistical rather than structural.
 *
 * It has already earned its keep twice:
 *   · it proved the replay contract (a career rebuilt from {seed, choices}
 *     must be byte-identical), which is the thing every share link depends on;
 *   · the NON-FINITE check catches the threaded-RNG slip where a {rng, value}
 *     pair gets used as a number — that shipped NaN clean sheets for every
 *     goalkeeper and stayed invisible until a screen finally displayed it.
 *
 * The BALANCE block underneath is not a pass/fail — it is the dashboard you
 * read after changing any constant in engine.js. Numbers worth watching:
 *   · "ambitious" must out-peak "loyal", or the game is punishing the whole
 *     premise of going abroad;
 *   · "played Israeli SENIOR league" should stay high (~75%), because a career
 *     that skips our league has skipped the point;
 *   · avg seasons ~18 and end age ~34; much beyond that is unrealistic for
 *     this sport and is a lot of clicking for a run that has stopped moving.
 *
 * The grade cutoffs in engine.js were measured from these runs. If you move
 * the balance constants, re-measure them.
 */
import { start, choose, careerSummary, replay, POSITIONS, CADENCES } from '../src/career/engine.js'

const teams = [
  { slug:'kb', name:'קריית ביאליק', primary_color:'#15d3f9', secondary_color:'#ea580c' },
  { slug:'bb', name:'בלג בוגרים', primary_color:'#15f919', secondary_color:'#ea580c' },
  { slug:'bn', name:'בלג נוער', primary_color:'#2e8e41', secondary_color:'#ea580c' },
  { slug:'gh', name:'גבעת עדה חלוצים', primary_color:'#ffffff', secondary_color:'#ea580c' },
  { slug:'gn', name:'גבעת עדה נוער', primary_color:'#155af9', secondary_color:'#ea580c' },
  { slug:'km', name:'קריית מוצקין', primary_color:'#969696', secondary_color:'#ea580c' },
  { slug:'ry', name:'רמת ישי', primary_color:'#f91515', secondary_color:'#ea580c' },
]

// Strategies a real player might follow.
const STRATS = {
  ambitious: (opts) => opts.find(o=>o.kind==='transfer') || opts[0],
  loyal:     (opts) => opts.find(o=>o.kind==='stay') || opts[0],
  random:    (opts, rnd) => opts[Math.floor(rnd()*opts.length)],
  firstAlways:(opts) => opts[0],
}

function mulberry(a){return ()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}

const issues = []
const rows = []

let n = 0
for (const pos of POSITIONS.map(p=>p.key)) {
  for (const cad of CADENCES.map(c=>c.key)) {
    for (const [sname, strat] of Object.entries(STRATS)) {
      for (let i=0;i<12;i++){
        n++
        const rnd = mulberry(n*7919)
        const cfg = { seed:`qa-${pos}-${cad}-${sname}-${i}`, lastName:'בדיקה', number:9, hand:'right', position:pos, cadence:cad }
        let s, choices=[]
        try { s = start(cfg, teams) } catch(e){ issues.push(`START THREW ${cfg.seed}: ${e.message}`); continue }
        let guard=0
        try {
          while (s.pending && !s.retired && guard++ < 120){
            const opts = s.pending.options
            if (!opts || !opts.length){ issues.push(`EMPTY OPTIONS ${cfg.seed} step ${s.step} card ${s.pending.id}`); break }
            const dup = new Set(opts.map(o=>o.key))
            if (dup.size !== opts.length) issues.push(`DUPLICATE OPTION KEYS ${cfg.seed} card ${s.pending.id}`)
            for (const o of opts){ if (!o.label) issues.push(`OPTION NO LABEL ${cfg.seed} ${o.key}`) }
            const opt = strat(opts, rnd)
            choices.push(opt.key)
            s = choose(s, opt.key, teams)
          }
        } catch(e){ issues.push(`CHOOSE THREW ${cfg.seed}: ${e.message}`); continue }
        if (guard>=120) issues.push(`NO TERMINATION ${cfg.seed}`)
        if (!s.retired) issues.push(`ENDED UNRETIRED ${cfg.seed} age ${s.player.age}`)

        const sum = careerSummary(s)
        // invariants
        if (s.blocks.some(b=>b.apps<0||b.goals<0||b.assists<0)) issues.push(`NEGATIVE STAT ${cfg.seed}`)
        // Catch the whole class of threaded-RNG slips: using a {rng,value}
        // pair as a number yields NaN, which propagates into totals silently.
        const NUMF=['apps','goals','assists','cleanSheets','position','tableSize','wage','overallBefore','overallAfter','injuryWeeks','age','season']
        for (const b of s.blocks) for (const f of NUMF)
          if (typeof b[f]!=='number' || !Number.isFinite(b[f])) { issues.push(`NON-FINITE ${f} ${cfg.seed}`); break }
        for (const [k,v] of Object.entries(sum))
          if (typeof v==='number' && !Number.isFinite(v)) issues.push(`NON-FINITE SUMMARY ${k} ${cfg.seed}`)
        if (s.blocks.some(b=>b.position<1||b.position>b.tableSize)) issues.push(`BAD TABLE POS ${cfg.seed}`)
        if (s.blocks.some(b=>b.overallAfter<40||b.overallAfter>99)) issues.push(`OVR OUT OF RANGE ${cfg.seed}`)
        if (pos==='GK' && sum.goals > sum.seasons*3) issues.push(`GK SCORING TOO MUCH ${cfg.seed}: ${sum.goals}`)
        if (sum.apps>0 && sum.goals/sum.apps > 2.2) issues.push(`GPG TOO HIGH ${cfg.seed}: ${(sum.goals/sum.apps).toFixed(2)}`)
        if (sum.earnings<0) issues.push(`NEGATIVE EARNINGS ${cfg.seed}`)
        // replay determinism
        const r = replay(cfg, choices, teams)
        if (JSON.stringify(careerSummary(r))!==JSON.stringify(sum)) issues.push(`REPLAY MISMATCH ${cfg.seed}`)

        rows.push({pos,cad,strat:sname,seasons:sum.seasons,peak:sum.peak,band:sum.topBand,trophies:sum.trophies.length,
                   apps:sum.apps,goals:sum.goals,caps:sum.caps,earn:sum.earnings,endAge:s.player.age,clubs:sum.clubCount,
                   israeliSenior: s.blocks.some(b=>b.band==='israel'), everAbroad: s.blocks.some(b=>!['academy','israel'].includes(b.band))})
      }
    }
  }
}

console.log('careers simulated:', rows.length)
console.log('ISSUES:', issues.length)
const counts = {}
issues.forEach(i=>{const k=i.split(' ').slice(0,3).join(' ');counts[k]=(counts[k]||0)+1})
Object.entries(counts).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>console.log('  ',v,'×',k))
if(issues.length) console.log('  e.g.', issues.slice(0,4).join('\n       '))

const avg=(f)=>(rows.reduce((a,r)=>a+f(r),0)/rows.length)
const pctOf=(f)=>(100*rows.filter(f).length/rows.length).toFixed(0)+'%'
console.log('\n--- BALANCE ---')
console.log('avg seasons', avg(r=>r.seasons).toFixed(1), '| avg end age', avg(r=>r.endAge).toFixed(1), '| avg peak OVR', avg(r=>r.peak).toFixed(1))
console.log('avg clubs', avg(r=>r.clubs).toFixed(1), '| avg trophies', avg(r=>r.trophies).toFixed(1), '| avg caps', avg(r=>r.caps).toFixed(1))
console.log('avg G/app', (avg(r=>r.goals)/avg(r=>r.apps)).toFixed(2))
console.log('played Israeli SENIOR league:', pctOf(r=>r.israeliSenior))
console.log('ever went abroad:', pctOf(r=>r.everAbroad))
console.log('\nbest band reached:')
const bands={}; rows.forEach(r=>bands[r.band]=(bands[r.band]||0)+1)
Object.entries(bands).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>console.log('  ',k, (100*v/rows.length).toFixed(0)+'%'))
console.log('\nby position (peak / trophies / G-per-app):')
for(const p of POSITIONS.map(x=>x.key)){const rs=rows.filter(r=>r.pos===p);console.log('  ',p, (rs.reduce((a,r)=>a+r.peak,0)/rs.length).toFixed(1), (rs.reduce((a,r)=>a+r.trophies,0)/rs.length).toFixed(1), (rs.reduce((a,r)=>a+r.goals,0)/Math.max(1,rs.reduce((a,r)=>a+r.apps,0))).toFixed(2))}
console.log('\nby cadence (seasons / peak):')
for(const c of CADENCES.map(x=>x.key)){const rs=rows.filter(r=>r.cad===c);console.log('  ',c, (rs.reduce((a,r)=>a+r.seasons,0)/rs.length).toFixed(1), (rs.reduce((a,r)=>a+r.peak,0)/rs.length).toFixed(1))}
console.log('\nby strategy (peak / trophies):')
for(const st of Object.keys(STRATS)){const rs=rows.filter(r=>r.strat===st);console.log('  ',st, (rs.reduce((a,r)=>a+r.peak,0)/rs.length).toFixed(1), (rs.reduce((a,r)=>a+r.trophies,0)/rs.length).toFixed(1))}
