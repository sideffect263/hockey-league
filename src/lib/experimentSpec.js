// The settings a /devs experiment may change, with what each one does in the engine.
// MIRROR of video-analysis/devlab/spec.py (EVENTS and BALL) (the worker validates against that file — it is the
// authority; this one only drives the form). Same keys, defaults and ranges; change both together.

export const EXPERIMENT_STAGES = {
  events: {
    label: 'מנוע האירועים',
    mapStage: 'events',
    desc: 'משנים הגדרות במנוע שמזהה מסירות, חטיפות, יירוטים ובעיטות. kookisnooki מריץ את המנוע על המחצית הראשונה של פתיחת העונה, ומשווה לכל האירועים שאדם סקר.',
    bench: 'פתיחת העונה 10-10 · 5 קטעים שנסקרו במחצית הראשונה · כל ריצות הסקירה של המחצית',
    runtime: 'כדקה',
  },
  ball: {
    label: 'זיהוי הכדור',
    mapStage: 'ball',
    desc: 'בוחרים אילו גלאים רצים יחד, איזה בודק (checker) מאשר כל מועמד, ואת הספים. kookisnooki מריץ על פריימים שמורים מפתיחת העונה — אף גלאי ברשימה לא אומן עליהם — ומשווה למצב היום.',
    bench: 'פתיחת העונה · 155 פריימים שמורים (96 עם כדור, 59 בלי) · 6 קטעים',
    runtime: 'כדקה (GPU); עם בדיקת מנוע — כשעה',
    caveat: 'זכרו את השיעור מהמפה: גלאי שמנצח כאן לא בהכרח משפר את מנוע האירועים (r8 ו-r9 ניצחו כאן והפסידו שם). תוצאה טובה כאן = מועמד לבדיקת מנוע מלאה, לא ברירת מחדל אוטומטית.',
  },
}

export const PARAM_GROUPS_EVENTS = {
  analyse: { label: 'מי שולט בכדור', desc: 'כל אירוע נבנה מ"רצפי שליטה": שחקן אחד ליד כדור איטי לאורך כמה פריימים. מעבר בין רצפים = אירוע.' },
  rules:   { label: 'כללי האירועים', desc: 'מתי מעבר שליטה נספר כמסירה, איבוד או בעיטה.' },
  ball:    { label: 'מסלול הכדור', desc: 'איך מחברים את מועמדי הכדור בכל פריים למסלול אחד.' },
  phys:    { label: 'העוקב הפיזיקלי (מסלול v6)', desc: 'מיקום + מהירות, חיכוך וקפיצה מהדופן. פועל רק כשמסלול הכדור הוא v6.' },
  input:   { label: 'קלט', desc: '' },
}

// kind: float | int | bool | enum
export const EVENT_PARAMS = [
  { key: 'reach', group: 'analyse', kind: 'float', def: 1.3, min: 0.6, max: 3.0, step: 0.1, unit: 'מ׳',
    label: 'טווח שליטה', help: 'הכי רחוק ששחקן יכול להיות מהכדור ועדיין "לשלוט" בו. גדול מדי — שחקן שעובר ליד נספר כשולט.' },
  { key: 'min_ctrl', group: 'analyse', kind: 'int', def: 3, min: 1, max: 10, step: 1, unit: 'פריימים',
    label: 'אורך שליטה מינימלי', help: 'כמה פריימים (12.5 בשנייה) שחקן צריך להיות עם הכדור כדי שזה ייחשב שליטה. קצר מדי — רעש הופך לאירועים.' },
  { key: 'bridge', group: 'analyse', kind: 'float', def: 0.4, min: 0, max: 2, step: 0.1, unit: 'שנ׳',
    label: 'גישור פערים', help: 'פער שבו הכדור "נעלם" ועדיין נחשב אותו רצף שליטה של אותו שחקן.' },
  { key: 'flicker', group: 'analyse', kind: 'float', def: 0.8, min: 0, max: 2, step: 0.1, unit: 'שנ׳',
    label: 'הבהוב של היריבה', help: 'שליטה קצרה של הקבוצה השנייה בין שני רצפים של אותה קבוצה — עד כמה קצרה נחשבת רעש ונמחקת.' },

  { key: 'pass_min', group: 'rules', kind: 'float', def: 3.0, min: 0.5, max: 8, step: 0.5, unit: 'מ׳',
    label: 'אורך מסירה מינימלי', help: 'מעבר בין שני שחקנים מאותה קבוצה נספר מסירה רק אם הכדור זז לפחות כך.' },
  { key: 'turnover_hold', group: 'rules', kind: 'float', def: 0.5, min: 0, max: 2, step: 0.1, unit: 'שנ׳',
    label: 'החזקה אחרי חטיפה', help: 'חטיפה/יירוט נספרים רק אם הקבוצה שזכתה בכדור החזיקה בו לפחות כך.' },
  { key: 'blade', group: 'rules', kind: 'bool', def: true,
    label: 'שליטה לפי להב המקל', help: 'מודדים את המרחק לכדור מהלהב (מהתנוחה) ולא רק מהרגליים. זה מה ששדרג את v6 ל-v7.' },
  { key: 'blade_feet_pen', group: 'rules', kind: 'float', def: 0.3, min: 0, max: 1.5, step: 0.05, unit: 'מ׳',
    label: 'קנס למרחק מהרגליים', help: 'כשיש להב, המרחק מהרגליים מקבל תוספת כזו — כדי שהלהב ינצח.' },
  { key: 'def_shot', group: 'rules', kind: 'bool', def: false,
    label: 'בעיטה שנבלמה בהגנה', help: 'שליטה שנגמרת באזור ההתקפה ומיד ההגנה ליד השער שלה — נספרת בעיטה (שנבלמה) ולא איבוד.' },
  { key: 'out', group: 'rules', kind: 'bool', def: false,
    label: 'כדור יצא', help: 'הכדור נראה אחרון ליד הדופן והמשחק עצר ל-2 שניות — אירוע "כדור יצא".' },

  { key: 'ball_path', group: 'ball', kind: 'enum', def: 'v6', options: [['v6', 'v6 — פיזיקה + v4 כגיבוי'], ['v4', 'v4 — tracklets בלבד']],
    label: 'גרסת מסלול', help: 'v6 משתמש בעוקב הפיזיקלי איפה שהוא רואה את הכדור, ובמסלול v4 בשאר.' },
  { key: 'fill_gap', group: 'ball', kind: 'float', def: 0.8, min: 0, max: 2, step: 0.1, unit: 'שנ׳',
    label: 'מילוי חורים', help: 'חור במסלול עד האורך הזה מתמלא בקו ישר בין שתי הנקודות.' },
  { key: 'kick_v', group: 'phys', kind: 'float', def: 25, min: 5, max: 50, step: 1, unit: 'מ׳/שנ׳',
    label: 'מהירות מכה', help: 'ליד שחקן, השער של העוקב נפתח לכל כיוון במהירות הזו — מקל יכול להכות את הכדור לכל מקום.' },
  { key: 'min_acc', group: 'phys', kind: 'float', def: 0.1, min: 0.02, max: 0.6, step: 0.02,
    label: 'ציון מינימלי למועמד', help: 'מועמד חלש יתקבל אם הוא בדיוק איפה שהפיזיקה צופה. נמוך = מקבלים יותר כדורים חלשים (ויותר טעויות).' },
  { key: 'switch_after', group: 'phys', kind: 'float', def: 0.4, min: 0, max: 2, step: 0.1, unit: 'שנ׳',
    label: 'מעבר לכדור רחוק', help: 'כמה זמן בלי לראות את הכדור לפני שזיהוי רחוק יכול "לחטוף" את המסלול.' },
  { key: 'gate', group: 'phys', kind: 'float', def: 1.0, min: 0.3, max: 3, step: 0.1, unit: 'מ׳',
    label: 'רדיוס חיפוש', help: 'מרחק מינימלי מהתחזית שבו מחפשים את הכדור בפריים הבא.' },
  { key: 'friction', group: 'phys', kind: 'float', def: 0.4, min: 0, max: 3, step: 0.1,
    label: 'חיכוך', help: 'כמה מהר הכדור מאט בתחזית (לשנייה).' },
  { key: 'hide_r', group: 'phys', kind: 'float', def: 1.2, min: 0.3, max: 3, step: 0.1, unit: 'מ׳',
    label: 'כדור מוסתר אצל שחקן', help: 'כשלא רואים את הכדור ושחקן קרוב לתחזית בטווח הזה — מניחים שהכדור אצלו.' },

  { key: 'use_pose', group: 'input', kind: 'bool', def: true,
    label: 'להשתמש בתנוחות (RTMPose)', help: 'בלי תנוחות אין להב מקל — שליטה רק לפי הרגליים.' },
]

// Ball detector (devlab/bench_ball.py). Model values are keys, never paths (spec.DETECTORS / CHECKERS).
export const PARAM_GROUPS_BALL = {
  model:      { label: 'אילו מודלים', desc: 'כמה גלאים רצים יחד (המועמדים של כולם מתאחדים), ובודק שנותן לכל מועמד ציון "זה באמת כדור".' },
  thresholds: { label: 'ספים', desc: 'איזה מועמד שורד. ציון סופי = ביטחון הגלאי × ציון הבודק × 1.3.' },
  engine:     { label: 'בדיקת מנוע מלאה', desc: 'הבדיקה שמחליטה אם גלאי נכנס: מזהים מחדש את הכדור בכל 5 הקטעים שנסקרו עם המודלים שבחרתם, ומריצים עליהם את מנוע האירועים של היום מול כל הסקירות האנושיות.' },
}

export const BALL_PARAMS = [
  { key: 'detectors', group: 'model', kind: 'set', def: ['black', 'black_r3', 'r7'], min: 1, max: 4,
    label: 'גלאים (1–4)', help: 'כל גלאי הוא YOLO11s שאומן אצלנו בסבב אחר. ברירת המחדל היום: black + black_r3 + r7.',
    options: [
      ['black', 'סבב 1 — הכדור השחור במגרש שלנו, בטוח בכדורים רגילים'],
      ['black_r3', 'סבב 3 — אומן עם טשטוש תנועה מלאכותי, תופס בעיטות מהירות'],
      ['r4', 'סבב 4 — תוויות אנושיות ראשונות; הראשון שרואה את הכדור האדום של מוצקין'],
      ['r5', 'סבב 5 — כל התוויות האנושיות עד אז'],
      ['r6', 'סבב 6 — כוונון על תוויות מעבדת הווידאו'],
      ['r7', 'סבב 7 — כל תוויות המעבדה (2.1k פריימים); ברירת המחדל'],
      ['r8', 'סבב 8 — +3 קטעים מתויגים מהפתיחה; ניצח כאן, הפסיד במנוע'],
      ['r9', 'סבב 9 — כל 6 הקטעים המתויגים'],
      ['r9s', 'self-training — 647 תוויות אוטומטיות שנבדקו בעין'],
    ] },
  { key: 'checker', group: 'model', kind: 'enum', def: 'v7',
    options: [['v7', 'v7 — ברירת המחדל, בודק אחד לשני המגרשים'], ['v8', 'v8 — סבב 7, פחות טעויות במגרש שלנו'], ['v9', 'v9 — סבב 8'],
      ['v10', 'v10 — סבב 9'], ['multivenue', 'multivenue — מקבל את הכדור האדום של מוצקין'], ['none', 'בלי בודק']],
    label: 'בודק (checker)', help: 'מסווג תמונה קטן (64px) שרואה חיתוך סביב כל מועמד ואומר כמה הוא כדור — מול מקל, גלגילית או כפפה.' },
  { key: 'imgsz', group: 'model', kind: 'enum', def: 640, options: [[640, '640 — כמו באימון'], [960, '960 — מגדיל כל אריח (איטי יותר)']],
    label: 'רזולוציית הרצה', help: 'כל פריים נחתך לאריחים של 640px; כאן קובעים לאיזה גודל כל אריח מוגדל לפני הגלאי.' },
  { key: 'det_conf', group: 'thresholds', kind: 'float', def: 0.15, min: 0.02, max: 0.6, step: 0.01,
    label: 'ביטחון מינימלי של הגלאי', help: 'מועמד מתחת לסף הזה לא נכנס בכלל. נמוך = יותר מועמדים לבודק.' },
  { key: 'topk', group: 'thresholds', kind: 'int', def: 5, min: 1, max: 10, step: 1,
    label: 'מועמדים לפריים', help: 'כמה מהמועמדים החזקים ביותר עוברים לבודק.' },
  { key: 'checker_min', group: 'thresholds', kind: 'float', def: 0.35, min: 0, max: 0.9, step: 0.05,
    label: 'ציון מינימלי מהבודק', help: 'מועמד שהבודק נתן לו פחות מזה נזרק.' },
  { key: 'final_min', group: 'thresholds', kind: 'float', def: 0.35, min: 0.05, max: 0.95, step: 0.05,
    label: 'ציון סופי מינימלי', help: 'הסף האחרון. גבוה = פחות כדורים שגויים, אבל גם פחות כדורים שנמצאים.' },
  { key: 'tile_overlap', group: 'thresholds', kind: 'float', def: 0.2, min: 0, max: 0.5, step: 0.05,
    label: 'חפיפה בין אריחים', help: 'כמה האריחים חופפים, כדי שכדור על הקו בין שניים לא ייחתך.' },
  { key: 'engine_test', group: 'engine', kind: 'bool', def: false,
    label: 'להריץ גם בדיקת מנוע מלאה', help: 'כשעה של GPU ב-kookisnooki לסט מודלים חדש (סט שכבר נבדק — דקות). משתמש רק בגלאים ובבודק; הספים למעלה הם לבדיקת הפריימים בלבד. דורש בודק.' },
]

export const STAGE_PARAMS = { events: EVENT_PARAMS, ball: BALL_PARAMS }
export const STAGE_GROUPS = { events: PARAM_GROUPS_EVENTS, ball: PARAM_GROUPS_BALL }

const same = (a, b) => Array.isArray(a) ? Array.isArray(b) && a.length === b.length && a.every(x => b.includes(x)) : a === b
export const paramDefaults = (stage = 'events') => Object.fromEntries((STAGE_PARAMS[stage] || []).map(p => [p.key, p.def]))
export const paramByKey = (stage, k) => (STAGE_PARAMS[stage] || []).find(p => p.key === k)

/** Only the settings that differ from today's default — what gets stored. */
export function changedParams(stage, values) {
  const out = {}
  for (const p of STAGE_PARAMS[stage] || []) if (values[p.key] !== undefined && !same(values[p.key], p.def)) out[p.key] = values[p.key]
  return out
}

export const EXP_STATUS = {
  queued:    { label: 'בתור',     cls: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
  running:   { label: 'רץ עכשיו', cls: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300' },
  done:      { label: 'הסתיים',   cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' },
  error:     { label: 'נכשל',     cls: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300' },
  cancelled: { label: 'בוטל',     cls: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400' },
}

export const EVENT_TYPE_LABELS = {
  pass: 'מסירה', pass_lost: 'מסירה שאבדה', steal: 'חטיפה', interception: 'יירוט', shot: 'בעיטה',
  goal: 'גול', save: 'הצלה', foul: 'עבירה', out: 'כדור יצא', won: 'זכייה בכדור',
}
