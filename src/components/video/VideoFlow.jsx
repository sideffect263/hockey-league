import { ChevronDown, Cpu, UserCheck, Clapperboard, ArrowLeft } from "lucide-react"
import { Film } from "@/components/icons/BrandIcons"

// "How a full game video goes through our models", drawn simply. Two depths:
//   variant="devs"     /devs map — 3 phases, every step opens its stage page, "what the computer sees" panels.
//   variant="creators" /creators העלאת וידאו — 4 big steps, what the editor does, the two output shapes.
// Numbers stay on the stage pages (standings) — this is only the picture of the order.

const WHO = {
  mac: { label: "מק", dot: "bg-slate-500" },
  gpu: { label: "שרת ה-GPU", dot: "bg-blue-500" },
  you: { label: "אדם", dot: "bg-rose-500" },
}

const PHASES = [
  {
    title: "מכינים", desc: "לפני שהמחשב רואה משהו",
    steps: [
      { stage: "sources", title: "וידאו גולמי", sub: "הורדה + קישור למשחק", who: ["mac"] },
      { stage: "audio", title: "ציר זמן וגולים", sub: "מחציות, הפסקה, זמני גולים", who: ["mac", "you"] },
      { stage: "rink", title: "כיול מצלמה", sub: "מקישים נקודות ← מטרים", who: ["you", "mac"] },
    ],
  },
  {
    title: "רואים", desc: "מה יש בכל פריים",
    steps: [
      { stage: "players", title: "שחקנים וקבוצות", sub: "קופסאות + צבע חולצה", who: ["gpu"] },
      { stage: "ball", title: "מועמדי כדור", sub: "הרבה נקודות, חלקן מזויפות", who: ["gpu"] },
      { stage: "pose", title: "תנוחות ומקל", sub: "איפה להב המקל", who: ["gpu"] },
    ],
  },
  {
    title: "מבינים", desc: "מפריימים למשחק",
    steps: [
      { stage: "ballpath", title: "מסלול הכדור", sub: "נקודות ← מסלול אחד", who: ["mac"] },
      { stage: "identity", title: "מי זה", sub: "כל מסלול מקבל שחקן", who: ["gpu", "mac"] },
      { stage: "events", title: "מנוע האירועים", sub: "מסירה, חטיפה, בעיטה", who: ["mac"], key: true },
      { stage: "measure", title: "סקירה אנושית", sub: "נכון / לא נכון / פספס", who: ["you"] },
    ],
  },
]
const OUTPUTS = [
  { stage: "highlights", title: "קליפי גולים, רחב + עומד" },
  { stage: "report", title: "דו״ח משחק" },
  { stage: "scene3d", title: "שחזור תלת-ממד" },
]

export default function VideoFlow({ variant = "devs", onOpen }) {
  return variant === "creators" ? <CreatorsFlow /> : <DevsFlow onOpen={onOpen} />
}

function Shell({ title, sub, children }) {
  return (
    <details open className="card group">
      <summary className="list-none cursor-pointer p-4 flex items-start gap-3 [&::-webkit-details-marker]:hidden">
        <span className="w-10 h-10 rounded-xl bg-brand/10 text-brand flex items-center justify-center shrink-0"><Film className="w-5 h-5" /></span>
        <span className="min-w-0 flex-1">
          <span className="block font-bold text-slate-900 dark:text-white">{title}</span>
          <span className="block text-sm text-slate-600 dark:text-slate-400 mt-0.5">{sub}</span>
        </span>
        <ChevronDown className="w-5 h-5 text-slate-400 shrink-0 transition-transform group-open:rotate-180" />
      </summary>
      <div className="px-4 pb-4 space-y-4">{children}</div>
    </details>
  )
}

function Who({ who }) {
  return (
    <span className="inline-flex gap-1">
      {who.map(k => <span key={k} title={WHO[k].label} className={`w-2 h-2 rounded-full ${WHO[k].dot}`} />)}
    </span>
  )
}

function DevsFlow({ onOpen }) {
  return (
    <Shell title="איך משחק מלא עובר אצלנו — בתמונה אחת"
      sub="מסרטון גולמי של משחק שלם ועד סטטיסטיקה וקליפים. מנוע האירועים רץ כמעט בסוף: הוא לא מסתכל על הווידאו, רק על מה שהשלבים לפניו מצאו.">
      <div className="grid gap-2 lg:grid-cols-[1fr_auto_1fr_auto_1fr_auto_0.8fr] items-stretch">
        {PHASES.map((ph, i) => (
          <PhaseCol key={ph.title} n={i + 1} phase={ph} onOpen={onOpen} />
        )).flatMap((col, i) => [col, <Arrow key={`a${i}`} />])}
        <div className="rounded-xl bg-amber-50 dark:bg-amber-900/20 p-3 space-y-2">
          <div className="text-xs font-black tracking-wide text-amber-800 dark:text-amber-300">תוצרים</div>
          {OUTPUTS.map(o => (
            <button key={o.stage} onClick={() => onOpen?.(o.stage)}
              className="w-full text-start text-sm font-semibold px-3 py-2 rounded-lg bg-white/80 dark:bg-slate-900/60 text-slate-800 dark:text-slate-100 hover:ring-2 hover:ring-amber-400/60 outline-none focus-visible:ring-2 focus-visible:ring-brand">
              {o.title}
            </button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
        {Object.values(WHO).map(w => <span key={w.label} className="inline-flex items-center gap-1.5"><span className={`w-2 h-2 rounded-full ${w.dot}`} />{w.label}</span>)}
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded border-2 border-amber-400" />המנוע</span>
        <span>· לוחצים על שלב כדי לפתוח את העמוד שלו</span>
      </div>
      <div className="rounded-lg border border-dashed border-amber-400/70 p-3 text-sm text-slate-700 dark:text-slate-300">
        <b className="text-amber-700 dark:text-amber-300">מסלול מהיר (רק קליפי גולים):</b> ציר זמן וגולים ← כיול (בשביל העיגול על הרצפה) ← זיהוי ומסלול כדור רק בחלונות קצרים סביב כל גול ← קליפים.
        <b className="text-slate-900 dark:text-white"> מסלול מלא (סטטיסטיקה):</b> כל השלבים על כל המשחק, ואז סקירה אנושית.
      </div>
      <div>
        <h3 className="text-sm font-black text-slate-900 dark:text-white mb-2">מה המחשב רואה בכל שלב</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {SEES.map(s => (
            <figure key={s.id} className="space-y-1.5 min-w-0">
              <div dir="ltr" className="rounded-lg bg-slate-100 dark:bg-slate-800 overflow-hidden"><Scene mode={s.id} /></div>
              <figcaption>
                <div className="text-sm font-bold text-slate-900 dark:text-white">{s.title}</div>
                <div className="text-xs text-slate-500 dark:text-slate-400">{s.desc}</div>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </Shell>
  )
}

function Arrow() {
  return (
    <div className="flex items-center justify-center text-slate-300 dark:text-slate-600 py-0.5">
      <ChevronDown className="w-5 h-5 lg:hidden" />
      <ArrowLeft className="w-5 h-5 hidden lg:block" />
    </div>
  )
}

function PhaseCol({ n, phase, onOpen }) {
  return (
    <div className="rounded-xl bg-slate-50 dark:bg-slate-800/50 p-3 space-y-2 min-w-0">
      <div>
        <div className="text-xs font-black tracking-wide text-brand">{n} · {phase.title}</div>
        <div className="text-[11px] text-slate-500 dark:text-slate-400">{phase.desc}</div>
      </div>
      {phase.steps.map(s => (
        <button key={s.stage} onClick={() => onOpen?.(s.stage)}
          className={`w-full text-start px-3 py-2 rounded-lg bg-white dark:bg-slate-900 border outline-none focus-visible:ring-2 focus-visible:ring-brand hover:border-brand/50 transition-colors ${s.key ? "border-amber-400 border-2" : "border-slate-200 dark:border-slate-700"}`}>
          <span className="flex items-center gap-2">
            <span className="text-sm font-bold text-slate-900 dark:text-white flex-1 min-w-0 truncate">{s.title}</span>
            <Who who={s.who} />
          </span>
          <span className="block text-xs text-slate-500 dark:text-slate-400 truncate">{s.sub}</span>
        </button>
      ))}
    </div>
  )
}

// ---- "what the computer sees": one made-up moment (a red pass, then a shot) in rink metres 40 x 20.
const SEES = [
  { id: "raw", title: "פריים גולמי", desc: "רק פיקסלים. המחשב עוד לא יודע כלום." },
  { id: "detect", title: "זיהוי", desc: "קופסאות לפי צבע חולצה, ומועמדי כדור — חלקם מזויפים." },
  { id: "track", title: "מסלול כדור", desc: "המזויפים נזרקים, הנקודות האמיתיות מתחברות." },
  { id: "map", title: "הבנה", desc: "מפה במטרים: המנוע קורא לאירועים בשם." },
]
const PL = [
  { x: 2, y: 10, t: "A", gk: 1 }, { x: 12, y: 7, t: "A" }, { x: 18, y: 14, t: "A" }, { x: 25, y: 6, t: "A" }, { x: 30, y: 13, t: "A" },
  { x: 38, y: 10, t: "B", gk: 1 }, { x: 15, y: 10, t: "B" }, { x: 22, y: 10, t: "B" }, { x: 29, y: 16, t: "B" }, { x: 33, y: 7, t: "B" },
]
const PATH = [[18.6, 13.6], [20.5, 11.5], [22.6, 9.2], [24.4, 7], [27, 7.6], [30, 8.4], [33, 9.1], [36, 9.7], [39.3, 10]]
const FAKES = [[20, 10], [16.2, 12.4]]
const team = (t) => t === "A" ? "fill-red-500 dark:fill-red-400" : "fill-blue-600 dark:fill-blue-400"
const teamStroke = (t) => t === "A" ? "stroke-red-500 dark:stroke-red-400" : "stroke-blue-600 dark:stroke-blue-400"
function proj(x, y) { const v = y / 20, hw = 80 + 32 * v; return [120 + (x / 40 - 0.5) * 2 * hw, 30 + v * 110, 0.7 + 0.5 * v] }

function Scene({ mode }) {
  const line = "stroke-slate-400 dark:stroke-slate-500"
  if (mode === "map") {
    const X = x => 14 + x * 5.3, Y = y => 22 + y * 5.3
    return (
      <svg viewBox="0 0 240 150" className="w-full h-auto block" role="img" aria-label="מפה מלמעלה עם מסירה ובעיטה">
        <defs>
          <marker id="vf-a1" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z" className="fill-slate-800 dark:fill-slate-100" /></marker>
          <marker id="vf-a2" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z" className="fill-amber-500" /></marker>
        </defs>
        <rect x={X(0)} y={Y(0)} width="212" height="106" rx="10" fill="none" strokeWidth="2" className={line} />
        <line x1={X(20)} y1={Y(0)} x2={X(20)} y2={Y(20)} className={line} />
        <circle cx={X(20)} cy={Y(10)} r="12" fill="none" className={line} />
        {PL.map((p, i) => <circle key={i} cx={X(p.x)} cy={Y(p.y)} r="3.6" className={team(p.t)} />)}
        <path d={`M${X(18.6)},${Y(13.6)} L${X(24.4)},${Y(7)}`} strokeWidth="1.6" className="stroke-slate-800 dark:stroke-slate-100" markerEnd="url(#vf-a1)" />
        <path d={`M${X(25)},${Y(6.6)} L${X(39.3)},${Y(10)}`} strokeWidth="2" className="stroke-amber-500" markerEnd="url(#vf-a2)" />
        <text x={X(13.5)} y={Y(9.6)} fontSize="10" fontWeight="700" className="fill-slate-800 dark:fill-slate-100">מסירה</text>
        <text x={X(30)} y={Y(6.2)} fontSize="10" fontWeight="700" className="fill-amber-600 dark:fill-amber-400">בעיטה</text>
        <text x={X(0.6)} y={Y(22.6)} fontSize="9" className="fill-slate-500">40 × 20 m</text>
      </svg>
    )
  }
  const ball = proj(22.6, 9.2)
  const c = proj(20, 10)
  return (
    <svg viewBox="0 0 240 150" className="w-full h-auto block" role="img" aria-label={mode}>
      <polygon points="40,30 200,30 232,140 8,140" fill="none" strokeWidth="2" className={line} />
      <line x1="120" y1="30" x2="120" y2="140" className={line} />
      <ellipse cx={c[0]} cy={c[1]} rx="13" ry="7" fill="none" className={line} />
      {[[0.4, 10], [39.6, 10]].map(([x, y], i) => { const p = proj(x, y); return <rect key={i} x={p[0] - 4} y={p[1] - 8} width="8" height="9" fill="none" strokeWidth="1.6" className="stroke-amber-500" /> })}
      {PL.map((p, i) => {
        const [sx, sy, s] = proj(p.x, p.y)
        return (
          <g key={i}>
            <rect x={sx - 3 * s} y={sy - 14 * s} width={6 * s} height={11 * s} rx={2 * s} className={team(p.t)} />
            <circle cx={sx} cy={sy - 16.5 * s} r={2.6 * s} className={team(p.t)} />
            {mode === "detect" && <rect x={sx - 6 * s} y={sy - 21 * s} width={12 * s} height={22 * s} fill="none" strokeWidth="1.1" strokeDasharray={p.gk ? "2 1.5" : undefined} className={teamStroke(p.t)} />}
          </g>
        )
      })}
      {mode === "track" ? (
        <>
          <polyline points={PATH.map(p => proj(...p).slice(0, 2).join(",")).join(" ")} fill="none" strokeWidth="1.4" strokeDasharray="3 2" className="stroke-slate-900 dark:stroke-white" />
          {PATH.map((p, i) => { const q = proj(...p); return <circle key={i} cx={q[0]} cy={q[1]} r="1.6" className="fill-slate-900 dark:fill-white" /> })}
        </>
      ) : <circle cx={ball[0]} cy={ball[1]} r="2.4" className="fill-slate-900 dark:fill-white" />}
      {mode === "detect" && (
        <>
          <circle cx={ball[0]} cy={ball[1]} r="5.5" fill="none" strokeWidth="1.5" className="stroke-emerald-500" />
          {FAKES.map(([x, y], i) => {
            const q = proj(x, y)
            return (
              <g key={i} strokeWidth="1.3" className="stroke-rose-500">
                <circle cx={q[0]} cy={q[1]} r="5" fill="none" />
                <path d={`M${q[0] - 3},${q[1] - 3} L${q[0] + 3},${q[1] + 3} M${q[0] + 3},${q[1] - 3} L${q[0] - 3},${q[1] + 3}`} />
              </g>
            )
          })}
        </>
      )}
    </svg>
  )
}

// ---- creators: the short version
const SIMPLE = [
  { icon: Film, title: "מעלים סרטון", desc: "קישור YouTube או קובץ של משחק שלם, ומשייכים אותו למשחק." },
  { icon: Cpu, title: "המחשב עובד", desc: "מוצא את הגולים, עוקב אחרי הכדור ומכין הילוך חוזר." },
  { icon: UserCheck, title: "אתם בודקים", desc: "רואים כל קליפ, מתקנים זמן גול אם צריך. שום דבר לא עולה לבד." },
  { icon: Clapperboard, title: "קליפים מוכנים", desc: "גרסה רחבה לאתר וגרסה עומדת לאינסטגרם, טיקטוק ווטסאפ." },
]

function CreatorsFlow() {
  return (
    <Shell title="מה קורה לסרטון אחרי שמעלים אותו" sub="ארבעה שלבים. החלק שלכם הוא הראשון והשלישי.">
      <ol className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        {SIMPLE.map((s, i) => (
          <li key={s.title} className={`rounded-xl p-3 space-y-1.5 ${i === 0 || i === 2 ? "bg-rose-50 dark:bg-rose-900/20" : i === 3 ? "bg-amber-50 dark:bg-amber-900/20" : "bg-slate-50 dark:bg-slate-800/50"}`}>
            <span className="flex items-center gap-2">
              <span className="w-7 h-7 rounded-full bg-white dark:bg-slate-900 text-brand flex items-center justify-center text-sm font-black shrink-0">{i + 1}</span>
              <s.icon className="w-4 h-4 text-slate-500 dark:text-slate-400" />
            </span>
            <span className="block text-sm font-bold text-slate-900 dark:text-white">{s.title}</span>
            <span className="block text-xs text-slate-600 dark:text-slate-400">{s.desc}</span>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-end gap-5">
        <Frame w={112} h={63} label="16:9 · לאתר ולפיד" />
        <Frame w={45} h={80} label="9:16 · לרשתות" />
        <p className="text-xs text-slate-500 dark:text-slate-400 flex-1 min-w-[12rem]">
          הגרסה העומדת לא חותכת את האמצע: היא עוקבת אחרי הכדור, כדי שהגול יישאר בתמונה.
        </p>
      </div>
    </Shell>
  )
}

function Frame({ w, h, label }) {
  return (
    <div className="space-y-1">
      <div style={{ width: w, height: h }} className="rounded-md bg-slate-200 dark:bg-slate-700 relative overflow-hidden">
        <span className="absolute w-2 h-2 rounded-full bg-slate-900 dark:bg-white" style={{ left: "55%", top: "60%" }} />
        <span className="absolute border-2 border-amber-400 rounded-sm" style={{ width: 10, height: 8, right: 4, top: "45%" }} />
      </div>
      <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">{label}</div>
    </div>
  )
}
