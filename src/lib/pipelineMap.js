// מפת המערכת: everything we build (video-AI pipeline, site, apps, data), stage by stage, for /devs.
//
// Every number and method here comes from video-analysis/ (HANDOFF-2026-10-13-match-engine.md,
// MORNING-REPORT-2026-10-14.md, the scripts' docstrings) — measured, not hoped. When a default
// model / engine version changes in video-analysis, update its stage here in the same session.
//
// Stage fields:
//   lane      which row of the map (LANES)
//   status    STAGE_STATUS key
//   runsOn    RUNS_ON keys (where it executes)
//   from      stage ids that feed it (drawn as "מקבל מ" / "מעביר ל")
//   method    how it works today, one line per technique
//   current   the version that runs by default
//   metrics   measured numbers [{ label, value, note? }]
//   tried     experiments [{ what, result, kept }] — kept=false is the useful part: what did NOT work
//   weak      known weak spots
//   next      open directions
//   files     paths (video-analysis/… or hockey-league src/…)
//   standings optional "איפה אנחנו עומדים" table {title, note, columns, rows: [{cells, current?}]} — measured comparisons;
//             a cell may be [ltr text, hebrew sub-line] (model names). live: 'ball'|'events' + row keys →
//             kept current from finished experiments (src/lib/standingsLive.js)
//   (what a developer can DO on a stage — action, tasks, thread — lives in stageWork.js)

export const LANES = [
  { id: 'input',      label: 'מקור הווידאו',  desc: 'מאיפה מגיעים הסרטונים' },
  { id: 'perception', label: 'רואים',          desc: 'מה יש בכל פריים: שחקנים, כדור, מגרש, תנוחות' },
  { id: 'understand', label: 'מבינים',         desc: 'מפריימים למשחק: מסלול כדור, מי זה, מה קרה' },
  { id: 'output',     label: 'תוצרים',         desc: 'מה הליגה מקבלת בסוף' },
  { id: 'platform',   label: 'האתר, האפליקציות והנתונים', desc: 'איפה כל זה פוגש את השחקנים והאוהדים' },
  { id: 'support',    label: 'איך משפרים',     desc: 'אימון המודלים ומדידה — הלולאה שמשפרת את כל השאר' },
]

export const STAGE_STATUS = {
  stable:   { label: 'יציב',           cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300', dot: 'bg-emerald-500' },
  improving:{ label: 'בשיפור',         cls: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300',                 dot: 'bg-sky-500' },
  bottleneck:{ label: 'צוואר בקבוק',   cls: 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300',             dot: 'bg-rose-500' },
  untested: { label: 'לא נבדק בשטח',   cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',         dot: 'bg-amber-500' },
}

export const RUNS_ON = {
  gpu:   'kookisnooki · GPU (RTX 4050, 6GB)',
  mac:   'Mac · CPU / MPS',
  phone: 'בטלפון (iOS / Android)',
  cloud: 'ענן (Cloudflare / Supabase)',
  web:   'בדפדפן',
}

export const STAGES = [
  // ── input ──────────────────────────────────────────────────────────────────
  {
    id: 'sources', lane: 'input', title: 'שידורים ומקורות וידאו', status: 'stable', runsOn: ['cloud', 'phone'], from: [],
    short: 'שידור היוטיוב, שידורי טלפון והעלאות למעבדה',
    method: [
      'מצלמת היוטיוב: מצלמה מוגבהת בצד המגרש שמסתובבת וזזה מנקודה קבועה, 1080p ב-25 פריימים לשנייה.',
      'שידורים מהאפליקציות: RTMP מהטלפון ← Cloudflare Stream עם הקלטה (WHIP לא הקליט, לכן RTMP).',
      'מעבדת וידאו: קליפים שמעלים מהטלפון מקודדים מחדש עם GOP קצר כדי שאפשר יהיה לעבור פריים-פריים.',
    ],
    current: 'משחק העבודה: פתיחת העונה 10-10 (רמת ישי 4–8 גבעת עדה נוער), YouTube sJ8llMyUntA, קריית ביאליק',
    metrics: [
      { label: 'משחק מלא', value: '59,375 פריימים', note: '25fps, 1080p' },
      { label: 'מגרשים עם וידאו', value: '2', note: 'קריית ביאליק, קריית מוצקין' },
    ],
    tried: [
      { what: 'שידור ב-WHIP (WebRTC)', result: 'לא נשמרה הקלטה — אין חומר גלם לניתוח', kept: false },
      { what: 'השתקת שידורים', result: 'האודיו נדרש לאיתור גולים — לא משתיקים יותר', kept: false },
    ],
    weak: ['רוב המשחקים בלי וידאו בכלל', 'מצלמה אחת — שחקנים מחוץ לפריים לא נראים'],
    next: ['מצלמה עוקבת אוטומטית בכל משחק', 'שתי מצלמות לכל משחק (במאי אוטומטי)'],
    files: ['video-analysis/lab_upload.py', 'supabase/functions/stream-golive/'],
  },

  // ── perception ─────────────────────────────────────────────────────────────
  {
    id: 'enhance', lane: 'perception', title: 'שיפור תמונה', status: 'stable', runsOn: ['mac', 'gpu', 'phone'], from: ['sources'],
    short: 'ניקוי רעש, ניגודיות, חדות ו-upscale ל-1080p',
    method: [
      'ffmpeg: hqdn3d (הסרת רעש) + eq (ניגודיות 1.12, רוויה 1.3, גמא 0.95) + cas 0.6 (חידוד).',
      'upscale ל-1080p לקליפים חלשים (480p → 1080p).',
      'בשידור חי: אותו פילטר על הטלפון — CoreImage ב-iOS, shader GLSL אחד ב-Android (~0.2ms לפריים ב-720p).',
    ],
    current: 'פילטר "שיפור תמונה" מאושר; פעיל כברירת מחדל בשידור',
    metrics: [{ label: 'עלות GPU בטלפון', value: '~0.2ms/פריים', note: '720p, נמדד ב-M4 Pro' }],
    tried: [
      { what: 'עטיפת sRGB ב-iOS', result: 'התמונה יצאה בהירה יותר במקום כהה יותר (מרחב העבודה של HaishinKit הוא gamma)', kept: false },
    ],
    weak: ['לא נבדק בשידור ארוך בטלפון אמיתי (חום, סוללה)'],
    next: ['מדידה אם השיפור עוזר לזיהוי הכדור (לא רק לעין)'],
    files: ['video-analysis/goal_fx.py', 'video-analysis/upscale.py'],
  },
  {
    id: 'players', lane: 'perception', title: 'זיהוי ומעקב שחקנים', status: 'stable', runsOn: ['gpu', 'mac'], from: ['sources'],
    short: 'YOLO11 מוצא אנשים, צבע החולצה מחלק לקבוצות, Kalman עוקב',
    method: [
      'גלאי YOLO11m (מחלקת person של COCO) ברזולוציה 1280, על כל פריים שני — 12.5 פריימים לשנייה.',
      'סינון קהל לפי גובה התיבה; קבוצה לפי צבע הגו (torso colour).',
      'מעקב במטרים על המגרש: Kalman + Hungarian matching, בלי חיבור מחדש של מסלולים שנקטעו.',
    ],
    current: 'game_detect.py v2 + player_tracks.py',
    metrics: [
      { label: 'זמן ריצה', value: '~3 שעות למשחק', note: 'kookisnooki GPU, כולל מועמדי כדור' },
      { label: 'טוהר מסלול', value: '~94%', note: 'מסלול = אדם אחד' },
      { label: 'אורך מסלול טיפוסי', value: '10–25 שניות' },
    ],
    tried: [],
    weak: ['מסלולים נקטעים (אין re-attach) — כל קטיעה היא "שחקן חדש"', 'שוערים בתלבושת כהה מתבלבלים בין הקבוצות'],
    next: ['חיבור מסלולים לפי מראה (embedding) מעל פערים'],
    files: ['video-analysis/game_detect.py', 'video-analysis/player_tracks.py'],
  },
  {
    id: 'ball', lane: 'perception', title: 'זיהוי הכדור', status: 'bottleneck', runsOn: ['gpu'], from: ['sources'],
    short: 'YOLO11s מאומן במיוחד + מסווג שני שמאשר כל מועמד',
    method: [
      'גלאי YOLO11s שאומן אצלנו (סבבי self-training), רץ על אריחים (tiles) של 640px כי הכדור זעיר.',
      'שומרים את כל המועמדים מעל conf 0.05 (עד 8 לפריים) — v1 זרק מתחת ל-0.35 וראה את הכדור רק ב-20% מהפריימים.',
      '"בודק" (checker): מסווג תמונה קטן שנותן לכל מועמד P(כדור).',
    ],
    current: 'גלאים black + black_r3 + r7 יחד, בודק v7',
    metrics: [
      { label: 'בדיקת holdout (פתיחת העונה)', value: '71/96 נמצאו · 2/59 שגויים', note: '155 פריימים שמורים, אחרי תיקוני התיוג של 10-14' },
      { label: 'מנוע (F1) עם הגלאי הזה', value: '0.617 ← 0.651 עם v7', note: 'מול סקירה אנושית' },
    ],
    standings: {
      title: 'איפה אנחנו עומדים — הגלאים מול שני מבחנים',
      live: 'ball',
      columns: ['מודלים', 'נמצאו בפריימים שמורים (מתוך 96)', 'כדור שגוי בפריים ריק (מתוך 59)', 'מנוע האירועים F1 (כל הסקירות)'],
      rows: [
        { key: 'black+black_r3+r7__v7', cells: [['black + black_r3 + r7', 'בודק v7'], '71', '2', '0.554'], current: true },
        { key: 'black+black_r3+r8__v7', cells: [['black + black_r3 + r8', 'בודק v7'], '73', '1', '0.506'] },
        { key: 'black+black_r3+r9__v10', cells: [['black + black_r3 + r9', 'בודק v10'], '75', '0', '0.466'] },
        { key: 'black+black_r3+r9s__v10', cells: [['black + black_r3 + r9s', 'בודק v10 · self-training'], '76', '0', '0.462'] },
      ],
      note: 'השורות נמדדו לראשונה ב-15/10 על אותם נתונים. הסדר בפריימים בודדים הפוך בדיוק לסדר במנוע: הגלאים החדשים מוצאים יותר כדורים, אבל המנוע מוצא איתם פחות מסירות, חטיפות ובעיטות נכונות. לכן גלאי נכנס רק אחרי "בדיקת מנוע מלאה" בניסויים. tnet לא בטבלה — הפריימים השמורים קרובים מדי לפריימי האימון שלו.',
    },
    tried: [
      { what: 'גלאי r8 (+3 קטעים מתויגים)', result: 'ניצח ב-holdout (28/35) אבל המנוע ירד ל-F1 0.556; למד כדור שגוי קבוע ליד הדפנות', kept: false },
      { what: 'גלאי r9 + checker v10 (6 קטעים)', result: 'הכי טוב ב-holdout (44/54, 0 שגויים) — המנוע ירד ל-0.498', kept: false },
      { what: 'גלאי r9s: self-training על 647 תוויות אוטומטיות (כולן נבדקו בעין)', result: 'ב-holdout 45/54 — המנוע 0.555', kept: false },
      { what: 'מודל tnet: U-Net זמני (3 פריימים כקלט, heat-map)', result: 'הכדור במקום הנכון הכי הרבה (holdout 54–57/82 מול 52) אבל אירועים F1 0.599 מול 0.632', kept: false },
      { what: 'בודק (checker) v9', result: 'הכפיל שגויים בפתיחה (3←6)', kept: false },
    ],
    weak: [
      'מגרש קריית מוצקין: כדור אדום-כהה על רצפה חומה — לא נלמד',
      'סקראמים: הכדור בין מקלות וגלגיליות, הגלאי כמעט לא רואה',
      'סיבוב מהיר של המצלמה (טשטוש)',
      'השיעור הגדול: ניצחון ב-holdout לא מנבא שיפור במנוע',
    ],
    next: ['imgsz 960 ו-YOLO11m (עוד לא הורצו)', 'אימון רב-מגרשי', 'tnet לציור בלבד (3D, סימון כדור)'],
    files: ['video-analysis/train_ball.py', 'video-analysis/ball_track2.py', 'video-analysis/tnet.py', 'video-analysis/eval_holdout_img.py'],
  },
  {
    id: 'rink', lane: 'perception', title: 'כיול מגרש ומצלמה', status: 'improving', runsOn: ['mac', 'web'], from: ['sources'],
    short: 'מפיקסלים למטרים: איפה כל דבר על המגרש',
    method: [
      'בוחרים 9 פריימים חדים שמכסים את הסיבוב של המצלמה (מודל סיבוב של stitcher).',
      'אדם מקיש נקודות ציון (קווים, פינות שער) במעבדה; rink_points.py מתאים מידות מגרש + מצלמה.',
      'rink_refine.py מושך את ההתאמה אל הקווים הצבועים; game_camera.py מתאים כל פריים ישירות ל-9 העוגנים (בלי סחיפה).',
      'קנה המידה המטרי: השער (1.70מ׳) בלבד — מידות הרחבה נשארו חופשיות בהתאמה.',
    ],
    current: 'ערכה אחת: קריית ביאליק (מצלמת היוטיוב)',
    metrics: [
      { label: 'מידות שנמדדו', value: '33.3 × 16.2 מ׳', note: '±7%' },
      { label: 'התאמה לקווים', value: '3.3px חציון' },
      { label: 'פריימים עם מצלמה', value: '100%', note: '59,375' },
    ],
    tried: [],
    weak: ['כל מגרש וכל מיקום מצלמה צריכים ערכה משלהם', 'קנה המידה נשען על השער בלבד'],
    next: ['ערכה למגרש נוסף', 'מיני-מפה מלמעלה לבדיקה ויזואלית'],
    files: ['video-analysis/rink_points.py', 'video-analysis/rink_geom.py', 'video-analysis/game_camera.py', 'src/lib/rinkLandmarks.js'],
  },
  {
    id: 'pose', lane: 'perception', title: 'תנוחות ומקל', status: 'improving', runsOn: ['gpu'], from: ['players'],
    short: '13 מפרקים לכל שחקן, ומהם — איפה להב המקל',
    method: [
      'RTMPose-l (body7, rtmlib, onnxruntime-gpu) על כל שחקן מזוהה.',
      'stick.py: נקודת הלהב = נקודה על הרצפה מתחת ליד התחתונה.',
      'לתלת-ממד: pose_lift.py מרים לתלת-ממד (קרן ← מישור אנכי ברגלי השחקן + אורכי עצמות), החלקת One-Euro.',
    ],
    current: 'משחק מלא (pose_full, 16 חלקים)',
    metrics: [
      { label: 'זמן ריצה', value: '~2.4 שעות למשחק', note: 'kookisnooki' },
      { label: 'להב מול רגליים', value: '0.27h מול 0.36h', note: 'מרחק חציוני מהכדור, ביחידות גובה שחקן' },
      { label: 'רעד בתלת-ממד', value: '16.9 ← 8.4', note: 'אחרי One-Euro' },
    ],
    tried: [
      { what: 'קו המקל מהידיים (shaft line)', result: 'גרוע יותר — ידיים בגובה החזה נותנות קו לצד', kept: false },
    ],
    weak: ['אין מודל למקל עצמו — רק הערכה מהידיים'],
    next: ['גלאי מקל אמיתי (keypoints של הלהב)'],
    files: ['video-analysis/pose_detect.py', 'video-analysis/stick.py', 'video-analysis/scene3d/pose_lift.py'],
  },

  // ── understand ─────────────────────────────────────────────────────────────
  {
    id: 'ballpath', lane: 'understand', title: 'מסלול הכדור', status: 'bottleneck', runsOn: ['mac'], from: ['ball', 'rink', 'players'],
    short: 'מעשרות מועמדים לפריים ← מסלול אחד שמתנהג כמו כדור אמיתי',
    method: [
      'tracklets של מועמדים במטרים + מסנן סימוני רצפה (נקודת האמצע הייתה 37% מהמועמדים!).',
      'drop_static: תא שיש בו מועמד ב-20 שניות מכל דקה = חפץ, לא כדור.',
      'v6: עוקב פיזיקלי (מיקום+מהירות, חיכוך, קפיצה מהדופן, אי-ודאות שגדלה עם הזמן) איפה שרואים, ומסלול v4 איפה שלא.',
    ],
    current: 'מסלול v6 (פיזיקה + v4 כגיבוי)',
    metrics: [
      { label: 'כדור במקום הנכון', value: '401/506', note: 'פריימים מתויגים; v4: 383' },
      { label: 'קפיצות בלתי אפשריות', value: '5,301 ← 73', note: 'העוקב הפיזיקלי לבד' },
      { label: 'כיסוי', value: '~91% מהפריימים' },
    ],
    tried: [
      { what: 'מסלול גלובלי DP / Viterbi עם prior של שחקנים', result: '87% במקום הנכון — אבל F1 של אירועים 0.530', kept: false },
      { what: 'עוקב פיזיקלי לבד', result: 'נקי מאוד, אבל מראה כדור רק ב-70% מהזמן ← F1 0.495', kept: false },
      { what: 'אינרציית החזקה (36 צירופים)', result: 'אף אחד לא ניצח את ברירת המחדל', kept: false },
      { what: 'סימוני רצפה רק כשהם עומדים', result: 'מסלול 81% אבל F1 0.570', kept: false },
    ],
    weak: ['5 פעמים: מסלול מדויק יותר ← פחות אירועים נכונים. האירועים תלויים בכדור ליד שחקנים, לא בדיוק כללי'],
    next: ['מדד מסלול שמתמקד ברגעי מגע עם המקל'],
    files: ['video-analysis/game_events.py', 'video-analysis/ballpath_exp.py'],
  },
  {
    id: 'identity', lane: 'understand', title: 'מי זה? זהות שחקנים', status: 'improving', runsOn: ['gpu', 'mac'], from: ['players'],
    short: 'מספר חולצה + מראה ← כל מסלול מקבל שם של שחקן אמיתי',
    method: [
      'מספר על הגב: jersey_track.py (OCR) על מסלולים.',
      'מראה: DINOv2 ViT-S/14 — embedding ממוצע לכל מסלול (עד 12 חיתוכים).',
      'player_ids.py: רגרסיה לוגיסטית לכל משחק על מסלולים מתויגים + "אי אפשר להיות פעמיים על המסך".',
      'טופס השיפוט = האמת למספרים; תשובות אנושיות מנצחות (identity_link).',
      'שוערים: לפי השער שהם עומדים בו בכל מחצית.',
    ],
    current: 'שילוב תשובות אנושיות + המודל (ids_linked.json)',
    metrics: [
      { label: 'דיוק (leave-one-out)', value: '94%' },
      { label: 'מהמסלולים שקיבלו שם — נכונים', value: '97%' },
      { label: 'מסלולים עם שם', value: '82%' },
      { label: 'נגיעות בכדור עם שם', value: '69%' },
    ],
    tried: [
      { what: 'מודל שוערים לפי צבע', result: 'ערבב את שני השוערים (שניהם בתלבושת כהה) — הוחלף בכלל "באיזה שער הוא עומד"', kept: false },
    ],
    weak: ['מספרים ברוסטר לא תואמים לווידאו (גבעת עדה נוער)', 'מודל לכל משחק בנפרד — לא לומד בין משחקים'],
    next: ['זהות שעוברת בין משחקים (אותו שחקן, משחק הבא)'],
    files: ['video-analysis/player_embed.py', 'video-analysis/player_ids.py', 'video-analysis/jersey_track.py', 'video-analysis/identity_link.py'],
  },
  {
    id: 'events', lane: 'understand', title: 'מנוע האירועים', status: 'improving', runsOn: ['mac'], from: ['ballpath', 'identity', 'pose', 'rink'],
    short: 'מי שולט בכדור, ומתי זה מסירה, חטיפה, יירוט או בעיטה',
    method: [
      'שליטה: מי הכי קרוב לכדור — לפי להב המקל (לא הרגליים) — לאורך זמן ("control spells").',
      'מעבר שליטה באותה קבוצה = מסירה; לקבוצה השנייה = חטיפה / יירוט / מסירה שאבדה.',
      'כדור מהיר לכיוון שער = בעיטה + תוצאה (גול / הצלה / החוצה).',
      'play_mask: זיהוי עצירות משחק כדי לא לספור שם.',
    ],
    current: 'מנוע v7 (פיזיקת כדור + "פריור מקל" מהתנוחה)',
    metrics: [
      { label: 'F1 מול הסקירה הראשונה', value: '0.651', note: 'נכונים 63% · נמצאו 68% · 121 אירועים' },
      { label: 'F1 מול כל 4 הסקירות', value: '0.554', note: 'נכונים 63% · נמצאו 49% · 176 אירועים — המספר שהניסויים משתמשים בו' },
      { label: 'מסירות', value: 'נכונים 66% · נמצאו 81%' },
      { label: 'בעיטות', value: 'נכונים 64% · נמצאו 64%' },
      { label: 'חטיפות', value: '1/10', note: 'החלק החלש' },
      { label: 'גולים שנראים במצלמה', value: '4/5' },
    ],
    standings: {
      title: 'איפה אנחנו עומדים — גרסאות המנוע מול שתי אמיתות',
      live: 'events',
      columns: ['גרסה', 'מה השתנה', 'F1 מול הסקירה הראשונה (121)', 'F1 מול כל הסקירות'],
      rows: [
        { cells: ['v4', 'כללים על מסלול הכדור הישן', '0.596', '0.492'] },
        { cells: ['v6', 'עוקב כדור פיזיקלי + סינון חפצים קבועים', '0.617', '0.519'] },
        { cells: ['v7', 'שליטה לפי להב המקל מהתנוחה', '0.651', '0.554'], current: true },
      ],
      note: 'הסקירה הראשונה נבנתה מההצעות של מנוע v3 — היא מתגמלת הסכמה איתו. "כל הסקירות" מוסיפה את הריצות שבהן אדם סקר רק אירועים שהמנוע הישן לא הציע, ולכן היא הוגנת יותר וקשה יותר. בשתיהן הסדר זהה: כל גרסה טובה מקודמתה. הסוגים עבירה / כדור יצא / גול / הצלה נמצאים באמת אבל המנוע לא מזהה אותם עדיין.',
    },
    tried: [
      { what: 'מנוע v4: 48 צירופי פרמטרים', result: 'תקרה ב-F1 ~0.60 — הכללים מוצו עם הקלט הזה', kept: false },
      { what: 'מנוע v6: פיזיקה + v4 כגיבוי', result: 'F1 0.591 ← 0.618', kept: true },
      { what: 'מנוע v7: פריור מקל', result: '0.618 ← 0.651', kept: true },
      { what: 'הבחנה חטיפה/יירוט לפי מרחק להב-להב', result: 'אין הפרדה נקייה (n≈12)', kept: false },
      { what: 'מצב שוער (GK_MODE)', result: '0.632 ← 0.634 — רעש', kept: false },
    ],
    weak: ['חטיפות בסקראם', 'האמת מוטה להצעות של המנוע הישן (רק 11 אירועים נוספו ע״י אדם)', 'מחצית שנייה: 217 אירועים מחכים לסקירה'],
    next: ['סקירה הוגנת של המחצית השנייה', 'מודל נלמד במקום כללים כשיהיו מספיק אירועים מתויגים'],
    files: ['video-analysis/game_events.py', 'video-analysis/eval_review.py', 'video-analysis/sweep_v4.py', 'src/components/creators/MatchReview.jsx'],
  },
  {
    id: 'audio', lane: 'understand', title: 'גולים מהאודיו', status: 'improving', runsOn: ['mac'], from: ['sources'],
    short: 'הקהל צועק בגול — מוצאים את השנייה המדויקת',
    method: [
      'מתחילים מהקשת השופט באפליקציה (שמגיעה 5+ שניות אחרי הגול) ומחפשים ב-30 השניות שלפניה.',
      'עוצמה ב-dB כל 0.1 שנייה, מוחלקת לשנייה, מול קו בסיס של 8 שניות — הזינוק החזק ביותר = שניית הגול.',
      'גרסה ראשונה (audio_events.py, סף חציון + k·MAD על כל המשחק) נכשלה בהקלטת 2016.',
    ],
    current: 'goal_worker.locate_goal',
    metrics: [{ label: 'השנייה הנכונה (±2s)', value: '~69%' }],
    tried: [],
    weak: ['טלפון שמסתובב לחגיגה מבלבל', 'שריקות וצעקות שלא קשורות לגול'],
    next: ['מסווג קול קטן (גול / שריקה / רעש) במקום סף'],
    files: ['video-analysis/goal_worker.py', 'video-analysis/audio_2026.py', 'video-analysis/audio_events.py'],
  },

  // ── output ─────────────────────────────────────────────────────────────────
  {
    id: 'report', lane: 'output', title: 'דו״ח משחק', status: 'improving', runsOn: ['mac'], from: ['events', 'identity'],
    short: 'סטטיסטיקה בסגנון FIFA: החזקה, בעיטות, מפות חום, שחקנים',
    method: [
      'player_stats.py: נגיעות, מסירות ובעיטות לכל שחקן מזוהה.',
      'build_report.py: החזקה לכל 3 דקות, מפת בעיטות (80 בעיטות), מפת חום לשחקן (תאים של 1מ׳), כל אירוע עם קישור ליוטיוב.',
    ],
    current: 'דו״ח פתיחת העונה (out/report) — עוד לא באתר',
    metrics: [{ label: 'דיוק כל המשחק', value: 'נכונים 62% · נמצאו 64%' }],
    tried: [],
    weak: ['רק משחק אחד', 'נגיעות בלי שם = 31%'],
    next: ['עמוד דו״ח משחק באתר'],
    files: ['video-analysis/build_report.py', 'video-analysis/player_stats.py'],
  },
  {
    id: 'shots', lane: 'output', title: 'סקאוטינג בעיטות', status: 'improving', runsOn: ['web'], from: ['rink'],
    short: 'מאיפה בועטים, לאן, ואיך השוער עמד — מתויג ביד',
    method: [
      'במעבדת הווידאו: מגיעים לרגע הבעיטה ולוחצים S — כרטיס בעיטה.',
      'הכרטיס שומר יורה, נקודת מוצא על תרשים המגרש, נקודה בשער, תוצאה ועמידת השוער (טבלת video_lab_shots).',
    ],
    current: 'תיוג ידני בלבד',
    metrics: [],
    tried: [],
    weak: ['רוב הקליפים הם רק גולים — אחוזי הצלה לפי אזור עוד לא בעלי משמעות', 'אין עדיין עמוד שמציג את הנתונים'],
    next: ['בעיטות אוטומטיות ממנוע האירועים (מיקום על המגרש כבר קיים)', 'עמוד שוער ומפת בעיטות לשחקן'],
    files: ['supabase/video-lab-shots.sql', 'src/components/creators/LabShots.jsx'],
  },
  {
    id: 'highlights', lane: 'output', title: 'תקצירי גולים', status: 'untested', runsOn: ['mac', 'cloud'], from: ['enhance', 'ball', 'audio'],
    short: 'כל גול ← קליפ משופר עם הילוך חוזר ← טיוטה לפיד',
    method: [
      'goal_fx.py: שיפור + upscale, הילוך חוזר עם zoom לשער, קו בעיטה וסימון כדור דק.',
      'goal_worker.py: שופט מסמן גול ← קליפ חי מ-Cloudflare ← עיבוד ב-goal_fx ← טיוטה (לעולם לא מתפרסם אוטומטית).',
      'highlight_reel.py: "כל הגולים של השבוע" — ספירה לאחור לפי מהירות בעיטה.',
    ],
    current: 'פעילים: goal_fx והתקציר השבועי. goal_worker עוד לא מותקן',
    metrics: [{ label: 'תקציר ראשון', value: '9 גולים, 68 שניות' }],
    tried: [
      { what: 'זיהוי שניית הגול מהתמונה', result: 'מתבלבל מטלפון שמסתובב לחגיגה — השנייה נקבעת בעין', kept: false },
    ],
    weak: ['המסלול החי (שידור ← טיוטה) לא נבדק במשחק אמיתי', 'סימון כדור כבוי במגרש עם כדור כהה'],
    next: ['התקנת goal_worker אחרי בדיקה בשידור אמיתי', 'התראה לעורכים כשטיוטה נוחתת'],
    files: ['video-analysis/goal_fx.py', 'video-analysis/goal_worker.py', 'video-analysis/highlight_reel.py'],
  },
  {
    id: 'scene3d', lane: 'output', title: 'שחזור תלת-ממד', status: 'improving', runsOn: ['mac', 'web'], from: ['pose', 'identity', 'ballpath', 'rink'],
    short: 'המהלך האמיתי מכל זווית, עם שמות ומספרים',
    method: [
      'export_scene.py: מסלולים + תנוחות + זהויות + כדור ← JSON לסצנה.',
      'three.js בדפדפן: מגרש מהכיול, שלד של 13 מפרקים, זוויות יציע / מלמעלה / מאחורי השער / עוקב כדור / "מצלמה אמיתית".',
      'היוטיוב הוא השעון — הסצנה מסונכרנת לסרטון.',
    ],
    current: '64 סצנות',
    metrics: [{ label: 'התאמת "מצלמה אמיתית"', value: '1.4px' }],
    tried: [
      { what: 'מודל tnet כמקור לכדור בתלת-ממד', result: 'יותר קפיצות (10.1 לדקה מול 4.1) — נשאר det2 + Viterbi', kept: false },
    ],
    weak: ['מצלמה אחת: שחקן שיוצא מהפריים נעלם', 'הכדור תמיד על הרצפה'],
    next: ['גובה כדור', 'חיזוי שחקנים מחוץ לפריים'],
    files: ['video-analysis/scene3d/export_scene.py', 'src/lib/scene3d/replay.js', 'src/lib/scene3d/skater.js'],
  },
  {
    id: 'autofollow', lane: 'output', title: 'מצלמה עוקבת + במאי', status: 'untested', runsOn: ['phone', 'cloud'], from: ['sources'],
    short: 'טלפון על חצובה שעוקב לבד; השרת מחליף בין מצלמות',
    method: [
      'YOLOX-Tiny (אנשים בלבד, Apache-2.0) בטלפון: קלט 640×384 ← חיתוך מתוך 4K.',
      'iOS: CoreML; Android: LiteRT (fp16, 10.2MB).',
      'במאי בשרת: כל טלפון מדווח פעילות; חיתוך אחרי 15 שניות השהיה, ממוצע 3s, +30%, החזקה 4s.',
    ],
    current: 'בנוי ב-iOS וב-Android, במאי חי בשרת',
    metrics: [],
    tried: [
      { what: 'זיהוי אנשים של Apple Vision', result: 'מצא 1–2 מתוך ~10 שחקנים', kept: false },
      { what: 'מודלי YOLO של Ultralytics', result: 'רישיון AGPL — לא מתאים לאפליקציה', kept: false },
    ],
    weak: ['לא נבדק במגרש: חום, סוללה, 50 דקות', 'סימולטור iOS מחזיר אפסים במודל fp16'],
    next: ['בדיקת שטח ראשונה', 'quantization ל-int8 ומדידת השהיה לכל מכשיר'],
    files: ['MOBILE-BUILD/AUTO-FOLLOW-SPEC.md', 'video-analysis/models/auto-follow/'],
  },
  {
    id: 'faces', lane: 'output', title: 'פנים בתמונות', status: 'stable', runsOn: ['mac'], from: [],
    short: 'מי מופיע בכל תמונה מאלבומי המשחקים',
    method: [
      'CompreFace: זיהוי פנים + embedding של 512 ממדים.',
      'אשכול לפי מרחק cosine (סף 0.24) ← קבוצות פנים; אדם נותן שם, מנהל מאשר.',
    ],
    current: '8 אלבומים',
    metrics: [
      { label: 'תמונות', value: '2,284' },
      { label: 'קבוצות פנים', value: '963' },
    ],
    tried: [],
    weak: ['רק חלק קטן מהקבוצות קיבל שם', 'קבוצות כפולות לאותו אדם'],
    next: ['להריץ על אלבומי העונה החדשה', 'הצעות איחוד אוטומטיות'],
    files: ['hockey-photos/cluster.py', 'src/components/admin/ClustersAdmin.jsx'],
  },

  // ── platform ───────────────────────────────────────────────────────────────
  {
    id: 'web', lane: 'platform', title: 'האתר', status: 'stable', runsOn: ['web', 'cloud'], from: [],
    short: 'rinkhockeyil.com — React, Vite, Supabase, בעברית ומימין לשמאל',
    method: [
      'React + Vite + Tailwind, פריסה ב-Vercel; Supabase (Postgres + RLS + Edge Functions + Realtime) כשרת.',
      'ענף dev ← אתר בדיקות; ענף main ← rinkhockeyil.com, ופריסה רק בלחיצת כפתור.',
      'גוגל ובוטים מקבלים HTML מוכן (api/seo.js) כדי שעמודי שחקנים ומשחקים יופיעו בחיפוש.',
      'טלמטריה עצמית: שגיאות וכשלים מהדפדפן נאספים בבסיס הנתונים.',
    ],
    current: 'Supabase Pro, api.rinkhockeyil.com',
    metrics: [],
    tried: [],
    weak: ['פרויקט Supabase אחד משרת גם את אתר הבדיקות וגם את האמיתי'],
    next: ['מעבר נגישות', 'שיפור טעינה ראשונה בטלפון'],
    files: ['CLAUDE.md', 'src/App.jsx', 'src/lib/api.js'],
  },
  {
    id: 'apps', lane: 'platform', title: 'אפליקציות iOS ו-Android', status: 'improving', runsOn: ['phone'], from: [],
    short: 'SwiftUI ו-Kotlin native — באותה גרסה, עם שידור ופיד',
    method: [
      'iOS ב-SwiftUI, Android ב-Kotlin / Jetpack Compose — שתיהן native, מול אותו Supabase כמו האתר.',
      'מספר גרסה ו-build משותפים לשתיהן.',
      'שידור מהטלפון (RTMP), התראות push (APNs / FCM), פיד, עמודי משחק.',
    ],
    current: 'iOS ב-App Store (ישראל), Android בבדיקה סגורה בגוגל פליי',
    metrics: [],
    tried: [],
    weak: ['כל פיצ׳ר נבנה פעמיים (+ באתר) — פערים בין הפלטפורמות', 'Android צריך 12+ בודקים ל-14 יום לפני פרסום'],
    next: ['רשימת פערים בין האתר לאפליקציות'],
    files: [],
  },
  {
    id: 'leaguedata', lane: 'platform', title: 'נתוני הליגה', status: 'stable', runsOn: ['cloud'], from: [],
    short: 'רוסטרים, משחקים, סטטיסטיקה — הבסיס של כל השאר',
    method: [
      'Postgres ב-Supabase עם RLS לכל טבלה; players היא הטבלה היחידה עם הרשאות עמודה.',
      'סיכומי שחקנים וקבוצות מתוחזקים בטריגרים, לא בחישוב בכל טעינה.',
      'טופס שיפוט מצולם ← תוצאה במערכת; סנכרון רפואי מ-Podium.',
    ],
    current: '',
    metrics: [],
    tried: [],
    weak: ['שחקנים בלי מספר, בלי עמדה ובלי תמונה', 'נתוני קטינים ונתונים רפואיים — הכל עובר דרך הרשאות'],
    next: ['בדיקות איכות לילית', 'ארכיון עונות קודמות'],
    files: ['supabase/player-season-totals.sql', 'src/lib/api.js'],
  },
  {
    id: 'stories', lane: 'platform', title: 'סיפורי משחק ב-AI', status: 'improving', runsOn: ['cloud'], from: ['leaguedata'],
    short: 'Claude כותב את סיפור המשחק מהתוצאה, מהסטטיסטיקה ומהסרטונים',
    method: [
      'רוטינה שבועית בונה חבילת נתונים: תוצאה, טבלה לפני ואחרי, MVP, פריימים מסרטונים.',
      'Claude כותב טיוטה; עורכים מאשרים לפני פרסום.',
      'כללים: רק עובדות שאפשר לאמת, בלי זיהוי פנים, בלי גילאים.',
    ],
    current: '',
    metrics: [],
    tried: [],
    weak: ['לרוב המשחקים אין וידאו — הסיפור נשען רק על מספרים'],
    next: ['בדיקה אוטומטית של כל מספר בסיפור'],
    files: ['scripts/game-story/ROUTINE.md', 'supabase/functions/game-story/index.ts'],
  },
  {
    id: 'ideas', lane: 'platform', title: 'רעיונות חדשים', status: 'improving', runsOn: [], from: [],
    short: 'יש לכם רעיון שלא מופיע במפה? זה המקום',
    method: [
      'רעיונות פתוחים: חיזוי תוצאות מבוסס נתונים, מאמן AI לשחקני נוער, תרגום שידורים לאנגלית, ניתוח שיפוט (עבירות לפי מצב משחק).',
    ],
    current: '',
    metrics: [],
    tried: [],
    weak: [],
    next: [],
    files: [],
  },

  // ── support ────────────────────────────────────────────────────────────────
  {
    id: 'training', lane: 'support', title: 'לולאת האימון', status: 'stable', runsOn: ['gpu', 'web'], from: [],
    short: 'תיוג אנושי ← חבילת אימון ← אימון על kookisnooki ← מדידה',
    method: [
      'תיוג במעבדה: כדור בקליפים, קטעי "תיוג כדור", סקירת אירועים, נקודות מגרש.',
      'harvest → crops → train → eval: כל סבב בונה חבילת delta, נשלחת ל-kookisnooki ומאומנת שם.',
      'self-training: המודל מתייג קטעים חדשים, רק ביטחון גבוה + בדיקה בעין.',
      'AMP (fp16) על ה-RTX 4050: פי 3.6 מהר יותר מ-fp32.',
    ],
    current: '9 סבבי כדור; תוויות אנושיות + תוויות של Claude (לאימון בלבד, אף פעם לא לבדיקה)',
    metrics: [
      { label: 'פריימים מתויגים בעין', value: '1,106+', note: '6 קטעים' },
      { label: 'סבב אימון (epoch) של tnet', value: '102s', note: 'AMP, batch 8' },
    ],
    tried: [],
    weak: ['רוב התוויות ממשחק אחד וממגרש אחד'],
    next: ['תיוג ממגרשים נוספים'],
    files: ['video-analysis/README.md', 'video-analysis/round9_build.py', 'video-analysis/round9_run.py', 'video-analysis/selftrain_build.py'],
  },
  {
    id: 'measure', lane: 'support', title: 'מדידה', status: 'stable', runsOn: ['mac'], from: [],
    short: 'כל שינוי נמדד מול אמת אנושית לפני שהוא נכנס',
    method: [
      'eval_review.py: precision / recall לכל סוג אירוע מול הסקירה האנושית.',
      'eval_holdout_img.py / eval_holdout.py: הגלאי על פריימים שמעולם לא אומן עליהם.',
      'ballpath_exp.py: מסלול הכדור מול תיוגים + F1 של המנוע, טוען פעם אחת ומריץ גרסאות.',
      'eval_scene.py: תלת-ממד — reprojection, PCK, רעד, כיסוי.',
    ],
    current: 'כלל: גלאי נחשב "טוב יותר" רק אחרי בדיקת מנוע על 5 קטעים (~שעה GPU לכל אחד)',
    metrics: [
      { label: 'אירועים אמיתיים בסקירה', value: '133' },
      { label: 'פריימי בדיקה לכדור', value: '89 עם כדור / 66 בלי' },
    ],
    tried: [
      { what: 'לשפוט גלאי לפי holdout בלבד', result: 'r8/r9 ניצחו שם והפסידו במנוע ב-6–12 נקודות F1', kept: false },
    ],
    weak: ['אמת מוטה: הסקירה נבנתה מהצעות המנוע הישן', 'רק משחק אחד מתויג'],
    next: ['סקירה עיוורת (בלי הצעות של מנוע)', 'אמת ממשחק שני'],
    files: ['video-analysis/eval_review.py', 'video-analysis/ballpath_exp.py', 'video-analysis/eval_holdout_img.py', 'video-analysis/scene3d/eval_scene.py'],
  },
]

export const stageById = (id) => STAGES.find(s => s.id === id) || null
/** Stages this one feeds. */
export const stageOutputs = (id) => STAGES.filter(s => s.from.includes(id))
