// מפת המערכת: the real video-AI pipeline, stage by stage, for /devs?tab=map.
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
//   topic     /devs topic id to join / discuss

export const LANES = [
  { id: 'input',      label: 'מקור הווידאו',  desc: 'מאיפה מגיעים הסרטונים' },
  { id: 'perception', label: 'רואים',          desc: 'מה יש בכל פריים: שחקנים, כדור, מגרש, תנוחות' },
  { id: 'understand', label: 'מבינים',         desc: 'מפריימים למשחק: מסלול כדור, מי זה, מה קרה' },
  { id: 'output',     label: 'תוצרים',         desc: 'מה הליגה מקבלת בסוף' },
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
    id: 'sources', lane: 'input', title: 'מקורות וידאו', status: 'stable', runsOn: ['cloud', 'phone'], from: [],
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
    topic: 'broadcast',
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
    topic: 'goal-highlights',
  },
  {
    id: 'players', lane: 'perception', title: 'זיהוי ומעקב שחקנים', status: 'stable', runsOn: ['gpu', 'mac'], from: ['sources'],
    short: 'YOLO11 מוצא אנשים, צבע החולצה מחלק לקבוצות, Kalman עוקב',
    method: [
      'YOLO11 (COCO person) על כל פריים שני — 12.5 פריימים לשנייה.',
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
    topic: 'player-id',
  },
  {
    id: 'ball', lane: 'perception', title: 'זיהוי הכדור', status: 'bottleneck', runsOn: ['gpu'], from: ['sources'],
    short: 'YOLO11s מאומן במיוחד + מסווג שני שמאשר כל מועמד',
    method: [
      'גלאי YOLO11s שאומן אצלנו (סבבי self-training), רץ על אריחים (tiles) של 640px כי הכדור זעיר.',
      'שומרים את כל המועמדים מעל conf 0.05 (עד 8 לפריים) — v1 זרק מתחת ל-0.35 וראה את הכדור רק ב-20% מהפריימים.',
      '"בודק" (checker): מסווג תמונה קטן שנותן לכל מועמד P(כדור).',
    ],
    current: 'גלאי r7 + checker v7',
    metrics: [
      { label: 'בדיקת holdout (פתיחת העונה)', value: '27/35 נמצאו · 3/41 שגויים', note: 'פריימים שהמודל לא ראה באימון' },
      { label: 'מנוע (F1) עם הגלאי הזה', value: '0.617 ← 0.651 עם v7', note: 'מול סקירה אנושית' },
    ],
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
    topic: 'ball-detection',
  },
  {
    id: 'rink', lane: 'perception', title: 'כיול מגרש ומצלמה', status: 'improving', runsOn: ['mac', 'web'], from: ['sources'],
    short: 'מפיקסלים למטרים: איפה כל דבר על המגרש',
    method: [
      'בוחרים 9 פריימים חדים שמכסים את הסיבוב של המצלמה (מודל סיבוב של stitcher).',
      'אדם מקיש נקודות ציון (קווים, פינות שער) במעבדה; rink_points.py מתאים מידות מגרש + מצלמה.',
      'rink_refine.py מושך את ההתאמה אל הקווים הצבועים; game_camera.py מתאים כל פריים ישירות ל-9 העוגנים (בלי סחיפה).',
      'עוגנים מטריים: שער 1.70מ׳, רחבה 9×5.4מ׳.',
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
    topic: 'rink-calibration',
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
    topic: 'scene3d',
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
    topic: 'match-stats',
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
    topic: 'player-id',
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
      { label: 'F1 מול סקירה אנושית', value: '0.651', note: 'נכונים 63% · נמצאו 68% · 121 אירועים' },
      { label: 'מסירות', value: 'נכונים 66% · נמצאו 81%' },
      { label: 'בעיטות', value: 'נכונים 64% · נמצאו 64%' },
      { label: 'חטיפות', value: '1/10', note: 'החלק החלש' },
      { label: 'גולים שנראים במצלמה', value: '4/5' },
    ],
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
    topic: 'match-stats',
  },
  {
    id: 'audio', lane: 'understand', title: 'גולים מהאודיו', status: 'improving', runsOn: ['mac'], from: ['sources'],
    short: 'הקהל צועק בגול — מוצאים את השנייה המדויקת',
    method: [
      'מעטפת עוצמה מוחלקת (hop 0.25s, החלקה 2s).',
      'סף = חציון + k·MAD; רגעים במרחק 12 שניות לפחות זה מזה.',
      'משלב עם הקשת השופט באפליקציה (שמגיעה 5+ שניות אחרי הגול).',
    ],
    current: 'audio_events.py',
    metrics: [{ label: 'השנייה הנכונה (±2s)', value: '~69%' }],
    tried: [],
    weak: ['טלפון שמסתובב לחגיגה מבלבל', 'שריקות וצעקות שלא קשורות לגול'],
    next: ['מסווג קול קטן (גול / שריקה / רעש) במקום סף'],
    files: ['video-analysis/audio_events.py', 'video-analysis/audio_2026.py'],
    topic: 'goal-highlights',
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
    topic: 'match-stats',
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
    topic: 'goal-highlights',
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
    topic: 'scene3d',
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
    topic: 'auto-camera',
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
    topic: 'face-matching',
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
    topic: 'ball-detection',
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
    topic: 'match-stats',
  },
]

export const stageById = (id) => STAGES.find(s => s.id === id) || null
/** Stages this one feeds. */
export const stageOutputs = (id) => STAGES.filter(s => s.from.includes(id))
