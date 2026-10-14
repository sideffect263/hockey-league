// The /devs topic catalog. Everything here is real work on the league's stack — the `now`
// lines come from the code and handoff docs (video-analysis/, supabase/, the apps), not wishes.
//
// Each topic carries one ACTION a developer can do right on the page:
//   { kind: 'tool',   tool: <TOOLS id> }      → an embedded existing tool (video lab, 3D, media…)
//   { kind: 'widget', widget: <widget id> }   → a light widget (components/devs/widgets) that
//                                               posts into the topic thread or reads real data
// plus `tasks` — concrete open items a dev can claim (claims are thread notes, "[claim:<id>]").
//
// Topic ids are the DB key in dev_topic_members / dev_topic_notes: [a-z0-9_-], never rename one.

export const AREAS = {
  video:  { label: 'ניתוח וידאו', icon: 'Film',         cls: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300' },
  models: { label: 'מודלים',      icon: 'BrainCircuit', cls: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300' },
  '3d':   { label: 'תלת-ממד',     icon: 'Box',          cls: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300' },
  camera: { label: 'מצלמות ושידור', icon: 'Video',      cls: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300' },
  ai:     { label: 'AI ותוכן',    icon: 'Sparkles',     cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' },
  data:   { label: 'נתונים',      icon: 'BarChart3',    cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
  media:  { label: 'תמונות ופנים', icon: 'Images',      cls: 'bg-pink-100 text-pink-700 dark:bg-pink-900/40 dark:text-pink-300' },
  app:    { label: 'האתר והאפליקציות', icon: 'Smartphone', cls: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200' },
}

export const STATUSES = {
  help_wanted: { label: 'מחפשים עזרה', cls: 'bg-brand text-white' },
  active:      { label: 'בעבודה',      cls: 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300' },
  idea:        { label: 'רעיון',       cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' },
  stable:      { label: 'יציב',        cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' },
}

// The tools that moved here from /creators. `tab` = the ?tab= deep link (old /creators links redirect here).
export const TOOLS = {
  lab:      { tab: 'lab',      label: 'מעבדת וידאו',      icon: 'FlaskConical', desc: 'כל המעבדה: קליפים, בעיטות, סקירת אירועים ונקודות מגרש' },
  scene3d:  { tab: 'scene3d',  label: 'שחזור תלת-ממד',    icon: 'Box',          desc: 'מהלכים אמיתיים משוחזרים בתלת-ממד, מסונכרנים ליוטיוב' },
  media:    { tab: 'media',    label: 'מדיה — מי בתמונה', icon: 'Camera',       desc: 'קבוצות פנים מאלבומי המשחקים: הצעת שם לכל קבוצה' },
  clusters: { tab: 'clusters', label: 'קבוצות תמונות',     icon: 'Images',       desc: 'אישור, שיוך לשחקן והסתרה של קבוצות פנים' },
}
// Narrow views of the lab used by single topics (VideoLab `focus`).
export const LAB_FOCUS = { 'lab-clips': 'clips', 'lab-shots': 'shots', 'lab-match': 'match', 'lab-rink': 'rink' }

export const TOPICS = [
  {
    id: 'ball-detection',
    area: 'models',
    title: 'זיהוי הכדור',
    tagline: 'כדור קטן, מהיר ולפעמים כהה — המודל צריך למצוא אותו בכל פריים',
    why: 'כל הסטטיסטיקה, סימון הכדור בסרטונים והשחזורים נשענים על מסלול הכדור. כשהכדור "נעלם", הכל אחריו נשבר.',
    status: 'help_wanted',
    now: 'גלאי YOLO11 שאומן בסבבי self-training (כרגע r7 ברירת מחדל). r8/r9 ניצחו במבחני כדור אבל הפסידו ברמת המנוע — גלאי נחשב "טוב יותר" רק אחרי redetect מלא של 5 קטעים. החסם: מגרשים חדשים (כדור אדום-כהה על רצפה חומה) ושעת ערב.',
    skills: ['Python', 'PyTorch', 'YOLO', 'OpenCV', 'תיוג נתונים'],
    action: { kind: 'tool', tool: 'lab-clips', label: 'תייגו כדור בקליפ', hint: 'פותחים קליפ, עוברים פריים-פריים ולוחצים על הכדור האמיתי (או "אין כדור"). כל תיקון נשמר כתווית אימון.' },
    steps: [
      'פתחו קליפ מסטטוס "לבדיקה" ותקנו 50–100 פריימים שבהם ה-AI טעה.',
      'קראו את video-analysis/README.md — סבבי האימון (harvest → crops → train → eval).',
      'רוצים לאמן? כתבו בשרשור — האימון רץ על kookisnooki (RTX 4050), לא צריך GPU משלכם.',
    ],
    tasks: [
      { id: 'tag-dark-ball', title: 'לתייג קליפים ממגרש עם כדור כהה (קריית מוצקין)' },
      { id: 'holdout-venue', title: 'להרכיב holdout רב-מגרשי (3 מגרשים, 300 פריימים)' },
      { id: 'tiny-model', title: 'לבדוק מודל קטן (YOLO11n) שירוץ בזמן אמת בטלפון' },
    ],
    links: ['video-analysis/README.md', 'video-analysis/train_ball.py', 'video-analysis/eval_holdout.py'],
  },
  {
    id: 'match-stats',
    area: 'video',
    title: 'מנוע סטטיסטיקת משחק',
    tagline: 'מסרטון משחק מלא → מסירות, בעיטות, חטיפות ואחזקת כדור, כמו בסוף משחק FIFA',
    why: 'אף ליגה בגודל שלנו לא מקבלת סטטיסטיקה כזאת. זה מה שיגרום לשחקנים לחזור לאתר אחרי כל משחק.',
    status: 'active',
    now: 'מנוע v7 (פיזיקת כדור + "פריור מקל" מתנוחת הידיים) מגיע ל-F1 0.651 מול סקירה אנושית (P 0.63 / R 0.68). צריך עוד סקירות אנושיות — האמת היום מוטה להצעות של המנוע הקודם.',
    skills: ['Python', 'ראייה ממוחשבת', 'סטטיסטיקה', 'הכרת המשחק'],
    action: { kind: 'tool', tool: 'lab-match', label: 'סקרו אירועים מול הווידאו', hint: 'בוחרים ריצה, צופים בכל אירוע ומסמנים נכון / שגוי / לא בטוח — ומוסיפים אירועים שהמנוע פספס. זה בדיוק מה שמודד את המנוע.' },
    steps: [
      'פתחו ריצה וסקרו 30 אירועים — מקשים V / X / U.',
      'מצאתם אירוע שהוחמץ? "פספס" מוסיף אותו בזמן הנוכחי בסרטון.',
      'מפתחים: game_events.py הוא הלב; ballpath_exp.py משווה גרסאות.',
    ],
    tasks: [
      { id: 'stoppage', title: 'זיהוי עצירות משחק (כדור מת) כדי לא לספור מסירות שם' },
      { id: 'goal-recall', title: 'בדיקת recall מול רשימת הגולים האמיתית מטופס השיפוט' },
      { id: 'report-page', title: 'עמוד דו״ח משחק באתר (נתונים כבר ב-out/report/*.json)' },
    ],
    links: ['video-analysis/game_events.py', 'video-analysis/HANDOFF-2026-10-13-match-engine.md', 'src/components/creators/MatchReview.jsx'],
  },
  {
    id: 'shot-scouting',
    area: 'data',
    title: 'סקאוטינג בעיטות',
    tagline: 'מאיפה בועטים, לאן, ואיך השוער עמד — נתוני סקאוטינג אמיתיים',
    why: 'מאמנים שואלים "איפה השוער שלהם חלש?" ו"מאיפה השחקן הזה מבקיע?". רק בעיטות מתויגות עונות על זה.',
    status: 'help_wanted',
    now: 'טבלת video_lab_shots חיה: יורה, נקודת מוצא על המגרש, נקודה בשער, תוצאה ועמידת השוער. רוב הקליפים הם רק גולים — צריך עוד בעיטות מתויגות כדי שאחוזי הצלה לפי אזור יהיו בעלי משמעות.',
    skills: ['הכרת המשחק', 'תיוג נתונים', 'SQL', 'ויזואליזציה'],
    action: { kind: 'tool', tool: 'lab-shots', label: 'תייגו בעיטות', hint: 'פותחים קליפ, מגיעים לרגע הבעיטה ולוחצים S — כרטיס הבעיטה נפתח. לא צריך לדעת לתכנת.' },
    steps: [
      'בחרו קליפ, לחצו S ברגע הבעיטה ומלאו את הכרטיס.',
      'סמנו את נקודת המוצא על המגרש ואת הנקודה בשער.',
      'יש לכם רעיון לגרף (מפת חום, אחוז הצלה לפי אזור)? כתבו בשרשור.',
    ],
    tasks: [
      { id: 'tag-5-games', title: 'לתייג את כל הבעיטות ב-5 משחקים' },
      { id: 'keeper-zones', title: 'עמוד אחוזי הצלה לפי אזור בשער, לכל שוער' },
      { id: 'shot-map', title: 'מפת בעיטות אישית בעמוד השחקן' },
    ],
    links: ['supabase/video-lab-shots.sql', 'src/components/creators/LabShots.jsx'],
  },
  {
    id: 'rink-calibration',
    area: '3d',
    title: 'כיול מגרש ומצלמה',
    tagline: 'להפוך פיקסלים למטרים: איפה בדיוק על המגרש קרה כל דבר',
    why: 'בלי כיול אין מהירויות, אין מרחקי בעיטה ואין שחזור תלת-ממד. כל מגרש וכל מצלמה צריכים כיול משלהם.',
    status: 'help_wanted',
    now: 'מקישים נקודות ציון (קווים, פינות שער) על 9 פריימים חדים ממצלמה; rink_points.py מתאים את הרצפה ומידות המגרש ומחזיר שגיאה לכל נקודה. ערכה ראשונה (קריית ביאליק) מחכה להקשות.',
    skills: ['עין חדה', 'גאומטריה', 'Python', 'OpenCV'],
    action: { kind: 'tool', tool: 'lab-rink', label: 'הקישו נקודות מגרש', hint: 'פותחים ערכה, בוחרים נקודת ציון בתרשים ומקישים עליה בתמונה (עם זכוכית מגדלת). "חשב מידות" מחזיר את ההתאמה תוך שניות.' },
    steps: [
      'פתחו ערכה ממתינה והקישו לפחות 4 נקודות בכל פריים.',
      'לחצו "חשב מידות" — נקודה אדומה (> 0.5 מ׳) כנראה הוקשה במקום הלא נכון.',
      'מפתחים: rink_geom.py ו-rink_points.py — הצעד הבא הוא מיני-מפה מלמעלה.',
    ],
    tasks: [
      { id: 'tap-bialik', title: 'להשלים את ערכת קריית ביאליק (9 פריימים)' },
      { id: 'minimap', title: 'מיני-מפה מלמעלה + קווי מגרש על הווידאו לבדיקה ויזואלית' },
      { id: 'new-venue', title: 'ערכת כיול למגרש נוסף' },
    ],
    links: ['video-analysis/rink_points.py', 'src/lib/rinkLandmarks.js', 'supabase/video-lab-rink.sql'],
  },
  {
    id: 'scene3d',
    area: '3d',
    title: 'שחזור מהלכים בתלת-ממד',
    tagline: 'מהלך אמיתי מהמשחק — מכל זווית, בהילוך איטי, עם שמות השחקנים',
    why: 'זה הרגע שבו שחקן רואה את הגול שלו מאחורי השער. תוכן שאין לאף ליגה אחרת.',
    status: 'active',
    now: 'three.js עם שלד של 13 מפרקים שמונע מ-RTMPose, זהויות לפי מספר חולצה, וזוויות יציע / מלמעלה / מאחורי השער / עוקב כדור. מגבלות: מצלמה אחת מסתובבת (שחקנים נעלמים מחוץ לפריים), הכדור תמיד על הרצפה.',
    skills: ['three.js', 'React', 'Python', 'Pose estimation', 'אנימציה'],
    action: { kind: 'tool', tool: 'scene3d', label: 'צפו ודרגו שחזור', hint: 'פתחו סצנה, השוו לווידאו האמיתי (תצוגת "מצלמה אמיתית") וכתבו בשרשור מה לא נראה נכון — שחקן במקום הלא נכון, תנועה לא טבעית.' },
    steps: [
      'צפו בסצנה אחת בכל הזוויות.',
      'כתבו בשרשור רגע (mm:ss) שבו השחזור שונה מהווידאו.',
      'מפתחים: src/lib/scene3d/replay.js + skater.js; הנתונים מ-video-analysis/scene3d/export_scene.py.',
    ],
    tasks: [
      { id: 'ball-height', title: 'גובה כדור (כרגע תמיד על הרצפה)' },
      { id: 'offscreen', title: 'לחזות שחקנים שיצאו מהפריים במקום להעלים אותם' },
      { id: 'share-clip', title: 'ייצוא סצנה לסרטון קצר לפיד' },
    ],
    links: ['src/lib/scene3d/replay.js', 'src/lib/scene3d/skater.js', 'video-analysis/scene3d/'],
  },
  {
    id: 'player-id',
    area: 'models',
    title: 'זיהוי שחקנים במשחק',
    tagline: 'מי זה? מספר חולצה, צבע קבוצה ומראה — לשייך כל מסלול לשחקן אמיתי',
    why: 'סטטיסטיקה אישית ("3 בעיטות, 2 חטיפות") דורשת לדעת מי עשה מה. זה גם מה שמכניס שמות לשחזור.',
    status: 'help_wanted',
    now: 'זהות שחקנים מגיעה ל-94% (leave-one-out) מתוך מספרי חולצה ו-embeddings. החסם המעשי: מספרי החולצה בבסיס הנתונים לא תמיד תואמים את מה שבווידאו (למשל בגבעת עדה נוער).',
    skills: ['Python', 'OCR', 'Re-ID', 'תיקון נתונים'],
    action: { kind: 'widget', widget: 'data-gaps', focus: 'jersey', label: 'מצאו חורים ברוסטר', hint: 'שחקנים בלי מספר חולצה או עמדה. מכירים אותם? כתבו את התיקון בשרשור — מספר נכון = זיהוי נכון.' },
    steps: [
      'עברו על הרשימה ובדקו שחקנים מהקבוצה שאתם מכירים.',
      'כתבו בשרשור: שם, קבוצה, מספר נכון.',
      'מפתחים: player_ids.py, jersey_track.py, player_embed.py.',
    ],
    tasks: [
      { id: 'givat-ada-numbers', title: 'לאמת מספרי חולצה של גבעת עדה נוער מול הווידאו' },
      { id: 'jersey-ocr', title: 'לשפר OCR של מספר על הגב בתנועה' },
    ],
    links: ['video-analysis/player_ids.py', 'video-analysis/jersey_track.py'],
  },
  {
    id: 'goal-highlights',
    area: 'video',
    title: 'תקצירי גולים אוטומטיים',
    tagline: 'שופט מסמן גול → קליפ מהשידור → עיבוד → טיוטה לפיד',
    why: 'כל גול בשידור הופך לסרטון מוכן לשיתוף בתוך דקות. זה מה שמביא אנשים לאפליקציה.',
    status: 'active',
    now: 'goal_fx.py: שיפור תמונה ו-upscale ל-1080p, הילוך חוזר עם zoom לשער, קו בעיטה וסימון כדור דק. goal_worker.py עבר dry-run על פתיחת העונה, הנתיב החי עוד לא נבדק בשידור אמיתי. איתור שניית הגול מהאודיו מצליח ~69%.',
    skills: ['Python', 'ffmpeg', 'עריכת וידאו', 'עין ביקורתית'],
    action: { kind: 'widget', widget: 'rate-videos', label: 'דרגו סרטונים מהפיד', hint: 'סרטונים אמיתיים מהפיד. דירוג + משפט אחד ("ההילוך החוזר נחתך מוקדם") עוזר לכוון את goal_fx.' },
    steps: [
      'דרגו 5 סרטונים — מה עובד ומה לא.',
      'מפתחים: goal_fx.py (הטיפול), goal_worker.py (הצינור), audio_events.py (שניית הגול).',
    ],
    tasks: [
      { id: 'audio-goal', title: 'לשפר זיהוי שניית הגול מהאודיו (69% → 90%)' },
      { id: 'notify-draft', title: 'התראה למנהלים כשטיוטה אוטומטית נוחתת' },
    ],
    links: ['video-analysis/goal_fx.py', 'video-analysis/goal_worker.py'],
  },
  {
    id: 'auto-camera',
    area: 'camera',
    title: 'מצלמה עוקבת אוטומטית',
    tagline: 'אייפון על חצובה במקום מצלמת Veo — AI שעוקב אחרי המשחק',
    why: 'מצלמה ייעודית עולה אלפי שקלים. טלפון ישן על חצובה שעוקב לבד = כל משחק משודר.',
    status: 'help_wanted',
    now: 'YOLOX-Tiny (רק אנשים) רץ על הטלפון וחותך מתוך 4K; במאי אוטומטי בשרת מחליף בין שני טלפונים לפי פעילות. iOS ו-Android בנויים — עוד לא נבדק במגרש אמיתי (חום, סוללה, 50 דקות).',
    skills: ['Swift', 'Kotlin', 'CoreML / TFLite', 'בדיקות שטח'],
    action: { kind: 'widget', widget: 'proposal', kinds: ['field', 'bug', 'idea'], label: 'דו״ח בדיקת שטח', hint: 'הייתם במשחק עם המצלמה? כתבו מה קרה: חום, סוללה, איבוד מעקב, איכות. גם רעיונות לשיפור.' },
    steps: [
      'בדיקת שטח: טלפון על חצובה 2–3 מ׳, כבל טעינה, משחק מלא.',
      'מלאו דו״ח שטח כאן.',
      'מפתחים: MOBILE-BUILD/AUTO-FOLLOW-SPEC.md — מתמטיקת המסגור משותפת ל-iOS ול-Android.',
    ],
    tasks: [
      { id: 'field-test', title: 'בדיקת שטח ראשונה — משחק מלא, טלפון אחד' },
      { id: 'heat-test', title: 'מדידת חום וסוללה ב-50 דקות' },
      { id: 'native-cut', title: 'חיתוך מיידי בצופים native (היום הם טוענים מחדש)' },
    ],
    links: ['MOBILE-BUILD/AUTO-FOLLOW-SPEC.md', 'video-analysis/models/auto-follow/'],
  },
  {
    id: 'broadcast',
    area: 'camera',
    title: 'שידורים חיים וריבוי מצלמות',
    tagline: 'כל אוהד יכול לשדר מהטלפון; במאי בוחר מה עולה לשידור',
    why: 'משפחות שלא מגיעות למגרש רואות את הילדים שלהן משחקים. כל שידור הוא גם חומר גלם לניתוח.',
    status: 'stable',
    now: 'RTMP מהאפליקציות → Cloudflare Stream עם הקלטה. חדר בקרה (/games/:id/control): תצוגות מקדימות, אישור מצלמות, פריסות pip / side / grid. "שיפור תמונה" חי בשידור. עוד לא נבדק בטלפון אמיתי לאורך זמן.',
    skills: ['React', 'HLS / RTMP', 'Swift', 'Kotlin'],
    action: { kind: 'widget', widget: 'proposal', kinds: ['bug', 'field', 'idea'], label: 'דווחו על שידור', hint: 'צפיתם או שידרתם? מה נתקע, איפה הייתה השהיה, מה היה חסר בחדר הבקרה.' },
    steps: [
      'צפו בשידור הבא מהאתר ומהאפליקציה.',
      'דווחו על כל תקלה עם שעה ומכשיר.',
    ],
    tasks: [
      { id: 'latency', title: 'מדידת השהיה מקצה לקצה (טלפון → צופה)' },
      { id: 'score-overlay', title: 'שכבת תוצאה חיה מעל השידור לצופים native' },
    ],
    links: ['src/pages/GameControl.jsx', 'supabase/functions/stream-golive/'],
  },
  {
    id: 'game-stories',
    area: 'ai',
    title: 'סיפורי משחק ב-AI',
    tagline: 'Claude כותב את סיפור המשחק מהתוצאה, מהסטטיסטיקה ומהסרטונים',
    why: 'עמוד משחק עם סיפור אמיתי מושך קוראים וגוגל. בלי זה עמוד משחק הוא רק תוצאה.',
    status: 'active',
    now: 'רוטינה שבועית בונה חבילת נתונים (תוצאה, טבלה לפני/אחרי, MVP, פריימים מסרטונים) ו-Claude כותב טיוטה; עורכים מאשרים. כללים: רק עובדות שאפשר לאמת, בלי זיהוי פנים, בלי גילאים. לרוב המשחקים אין וידאו — רק מספרים.',
    skills: ['כתיבה בעברית', 'Prompt engineering', 'TypeScript'],
    action: { kind: 'widget', widget: 'rate-stories', label: 'דרגו סיפורים שפורסמו', hint: 'קראו סיפור, דרגו 1–5 וכתבו מה לא עבד (עובדה שגויה, ניסוח רובוטי, חזרות). זה מזין את ה-prompt הבא.' },
    steps: [
      'דרגו 3 סיפורים.',
      'מצאתם עובדה שגויה? זה הכי חשוב — כתבו אותה.',
      'מפתחים: scripts/game-story/ROUTINE.md + supabase/functions/game-story.',
    ],
    tasks: [
      { id: 'tone-guide', title: 'מדריך סגנון קצר לסיפורים (טון, אורך, מה אסור)' },
      { id: 'fact-check', title: 'בדיקה אוטומטית של כל מספר בסיפור מול box score' },
    ],
    links: ['scripts/game-story/ROUTINE.md', 'supabase/functions/game-story/index.ts'],
  },
  {
    id: 'face-matching',
    area: 'media',
    title: 'זיהוי פנים בתמונות',
    tagline: 'אלפי תמונות מאלבומי המשחקים — מי מופיע בכל אחת',
    why: 'כשקבוצת פנים מקבלת שם, כל התמונות של השחקן מופיעות אוטומטית בפיד ובעמוד שלו.',
    status: 'help_wanted',
    now: 'CompreFace זיהה פנים ב-~2,300 תמונות מ-8 אלבומים ואיחד אותן ל-963 קבוצות. רק חלק קטן מזוהה. כל שם שמוצע ומאושר מעשיר את הפיד מיד (photo_players הוא view).',
    skills: ['היכרות עם השחקנים', 'Python', 'Face embeddings'],
    action: { kind: 'tool', tool: 'media', label: 'הציעו שמות לקבוצות פנים', hint: 'מזהים מישהו? כתבו שם פרטי ומשפחה. הצעות מצטברות ומנהל מאשר.' },
    steps: [
      'עברו על 20 קבוצות והציעו שמות למי שאתם מכירים.',
      'בכלי "קבוצות תמונות" (בלשונית כלים) אפשר לאשר ולשייך לשחקן.',
      'מפתחים: hockey-photos/ — CompreFace + clustering (סף cosine 0.24).',
    ],
    tasks: [
      { id: 'new-albums', title: 'להריץ את הצינור על אלבומי העונה החדשה' },
      { id: 'merge-clusters', title: 'הצעת איחוד לקבוצות שהן אותו אדם' },
    ],
    links: ['src/lib/media.js', 'src/components/admin/ClustersAdmin.jsx'],
  },
  {
    id: 'data-quality',
    area: 'data',
    title: 'נתוני הליגה',
    tagline: 'רוסטרים, סטטיסטיקה ומספרים — הבסיס של כל השאר',
    why: 'כל מודל, סיפור ושחזור נשען על הנתונים בבסיס. שחקן בלי מספר = שחקן שה-AI לא יזהה.',
    status: 'stable',
    now: 'סיכומי שחקנים וקבוצות מתוחזקים בטריגרים; טופס שיפוט מצולם מוזן ומאומת. עדיין יש שחקנים בלי מספר, בלי עמדה ובלי תמונה.',
    skills: ['SQL', 'Postgres', 'Supabase', 'סדר וארגון'],
    action: { kind: 'widget', widget: 'data-gaps', focus: 'all', label: 'בדקו חורים בנתונים', hint: 'רשימה חיה של מה שחסר. מכירים את התשובה? כתבו בשרשור, מנהל יעדכן.' },
    steps: [
      'סננו לפי קבוצה ובדקו מה חסר.',
      'כתבו תיקונים בשרשור (שם → מספר / עמדה).',
      'מפתחים: supabase/*.sql — שימו לב ש-players הוא הטבלה היחידה עם הרשאות עמודה (לא select *).',
    ],
    tasks: [
      { id: 'photos', title: 'תמונות פרופיל לשחקנים (photo_url ריק כמעט לכולם)' },
      { id: 'history', title: 'ייבוא תוצאות עונות קודמות לארכיון' },
    ],
    links: ['supabase/player-season-totals.sql', 'src/lib/api.js'],
  },
  {
    id: 'web-app',
    area: 'app',
    title: 'האתר',
    tagline: 'rinkhockeyil.com — React, Vite, Supabase, בעברית ומימין לשמאל',
    why: 'הבית של הליגה: טבלה, משחקים, פיד, שידורים. כל שיפור כאן רואים מאות אנשים בשבוע.',
    status: 'stable',
    now: 'React + Vite + Tailwind על Vercel, Supabase עם RLS, טלמטריה ראשונית. עבודה בענפים קטנים: dev → בדיקה → main → פריסה ידנית.',
    skills: ['React', 'Tailwind', 'עיצוב', 'נגישות', 'SQL'],
    action: { kind: 'widget', widget: 'proposal', kinds: ['bug', 'idea', 'proposal', 'question'], label: 'דווחו באג או הציעו שיפור', hint: 'מה מעצבן, מה חסר, מה נשבר בטלפון. עם קישור לעמוד — אפילו טוב יותר.' },
    steps: [
      'גלשו באתר מהטלפון ודווחו על כל דבר שנראה שבור.',
      'מפתחים: CLAUDE.md בשורש הריפו — ענפים, פריסה והמלכודות שכבר עלו לנו בזמן.',
    ],
    tasks: [
      { id: 'a11y-pass', title: 'מעבר נגישות (קורא מסך, ניגודיות) על הדפים הראשיים' },
      { id: 'perf', title: 'שיפור טעינה ראשונה בטלפון (Lighthouse)' },
    ],
    links: ['CLAUDE.md', 'src/App.jsx'],
  },
  {
    id: 'mobile-apps',
    area: 'app',
    title: 'אפליקציות iOS ו-Android',
    tagline: 'SwiftUI ו-Kotlin native — באותה גרסה, עם שידור ופיד',
    why: 'רוב המשתמשים בטלפון. האפליקציה היא גם המצלמה של הליגה.',
    status: 'active',
    now: 'iOS (SwiftUI) ו-Android (Kotlin/Compose) native, מספר גרסה משותף. Android בבדיקה סגורה בגוגל פליי — צריך 12+ בודקים ל-14 יום.',
    skills: ['Swift', 'SwiftUI', 'Kotlin', 'Jetpack Compose', 'בדיקות QA'],
    action: { kind: 'widget', widget: 'proposal', kinds: ['bug', 'idea', 'question'], label: 'דווחו מהאפליקציה', hint: 'כתבו מכשיר, גרסה ומה קרה. צילום מסך? תארו במילים איפה.' },
    steps: [
      'הצטרפו לבדיקה (Android) או ל-TestFlight (iOS) — בקשו בשרשור.',
      'דווחו כל באג עם מכשיר וגרסה.',
    ],
    tasks: [
      { id: 'android-testers', title: 'להיות אחד מ-12 בודקי Android ל-14 יום' },
      { id: 'parity', title: 'פיצ׳רים שיש באתר ואין באפליקציות — רשימה' },
    ],
    links: [],
  },
  {
    id: 'new-ideas',
    area: 'ai',
    title: 'רעיונות חדשים',
    tagline: 'יש לכם רעיון שלא מופיע כאן? זה המקום',
    why: 'הרבה מהדברים כאן התחילו ממשפט אחד בוואטסאפ. הרעיון הבא יכול להיות שלכם.',
    status: 'idea',
    now: 'רעיונות פתוחים: חיזוי תוצאות מבוסס נתונים, מאמן AI לשחקני נוער, תרגום שידורים לאנגלית, ניתוח שיפוט (עבירות לפי מצב משחק).',
    skills: ['כל אחד'],
    action: { kind: 'widget', widget: 'proposal', kinds: ['idea', 'proposal', 'question'], label: 'הציעו רעיון', hint: 'כותרת אחת ושני משפטים: מה זה ולמה זה טוב לליגה.' },
    steps: [
      'כתבו את הרעיון בשתי שורות.',
      'אחרים מצטרפים לנושא ומגיבים — רעיון עם תמיכה עובר לנושא משלו.',
    ],
    tasks: [],
    links: [],
  },
]

export const topicById = (id) => TOPICS.find(t => t.id === id) || null
