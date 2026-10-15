// The hands-on half of every /devs map stage (2026-10-15: the old "נושאים" catalog, src/lib/devTopics.js,
// merged into the map). pipelineMap.js says what a stage IS; stageStories.js how we got there; this file
// says what a developer can DO on it right now:
//   why        why it matters to the league (one paragraph)
//   helpWanted shown as "מחפשים עזרה" on the map
//   skills     what helps to contribute
//   action     the one thing to do on the page:
//                { kind: 'tool', tool: <TOOLS id | LAB_FOCUS id> }   an embedded tool (video lab, 3D, faces…)
//                { kind: 'widget', widget: 'proposal'|'rate-stories'|'rate-videos'|'data-gaps', … }
//                { kind: 'experiment', stage: <experimentSpec stage> } → /devs?tab=exp&new=1
//   steps      how to start
//   tasks      open items a developer can claim (claims are thread notes "[claim:<id>]")
//
// The stage id is the DB key of its thread and members (dev_topic_notes / dev_topic_members.topic_id):
// never rename a stage id once people have posted.

// Tools (the ones moved from /creators). `tab` = deep link ?tab=<tab> (old /creators links redirect here).
export const TOOLS = {
  lab:      { tab: 'lab',      label: 'מעבדת וידאו',      icon: 'FlaskConical', desc: 'כל המעבדה: קליפים, בעיטות, סקירת אירועים ונקודות מגרש' },
  scene3d:  { tab: 'scene3d',  label: 'שחזור תלת-ממד',    icon: 'Box',          desc: 'מהלכים אמיתיים משוחזרים בתלת-ממד, מסונכרנים ליוטיוב' },
  media:    { tab: 'media',    label: 'מדיה — מי בתמונה', icon: 'Camera',       desc: 'קבוצות פנים מאלבומי המשחקים: הצעת שם לכל קבוצה' },
  clusters: { tab: 'clusters', label: 'קבוצות תמונות',     icon: 'Images',       desc: 'אישור, שיוך לשחקן והסתרה של קבוצות פנים' },
}
// Narrow views of the lab used by single stages (VideoLab `focus`).
export const LAB_FOCUS = { 'lab-clips': 'clips', 'lab-shots': 'shots', 'lab-match': 'match', 'lab-rink': 'rink' }

const proposal = (label, hint, kinds = ['idea', 'proposal', 'question', 'bug']) => ({ kind: 'widget', widget: 'proposal', kinds, label, hint })

export const WORK = {
  sources: {
    why: 'משפחות שלא מגיעות למגרש רואות את הילדים שלהן משחקים, וכל שידור הוא גם חומר גלם לכל הניתוח. בלי וידאו אין שום דבר אחר במפה.',
    skills: ['React', 'HLS / RTMP', 'Swift', 'Kotlin', 'Cloudflare Stream'],
    action: proposal('דווחו על שידור', 'צפיתם או שידרתם? מה נתקע, איפה הייתה השהיה, מה היה חסר בחדר הבקרה. שעה + מכשיר.', ['bug', 'field', 'idea']),
    steps: ['צפו בשידור הבא מהאתר ומהאפליקציה.', 'דווחו כל תקלה עם שעה ומכשיר.', 'מפתחים: src/pages/GameControl.jsx (חדר הבקרה) ו-supabase/functions/stream-golive.'],
    tasks: [
      { id: 'latency', title: 'מדידת השהיה מקצה לקצה (טלפון ← צופה)' },
      { id: 'score-overlay', title: 'שכבת תוצאה חיה מעל השידור לצופים באפליקציות' },
    ],
  },
  enhance: {
    why: 'קליפים מטלפונים באולם חשוך הם רוב חומר הגלם. תמונה נקייה יותר נראית טוב יותר בפיד — ואולי גם עוזרת לגלאים.',
    skills: ['ffmpeg', 'עיבוד תמונה', 'CoreImage / GLSL'],
    action: { kind: 'widget', widget: 'rate-videos', label: 'דרגו סרטונים מהפיד', hint: 'סרטונים אמיתיים מהפיד, כולם עברו את השיפור. איך נראית התמונה? רעש, צבעים, חדות.' },
    steps: ['דרגו 5 סרטונים — משפט אחד על התמונה.', 'מפתחים: הפילטר ב-goal_fx.py; בשידור — PictureEnhancement (iOS) ו-PictureEnhanceFilterRender (Android).'],
    tasks: [{ id: 'enhance-detector', title: 'למדוד אם השיפור מעלה את זיהוי הכדור (holdout עם ובלי)' }],
  },
  players: {
    why: 'כל אירוע במשחק מתחיל מ"מי נמצא איפה". מסלול שחקן שנקטע = שחקן חדש, וזה שובר מסירות וסטטיסטיקה אישית.',
    skills: ['Python', 'YOLO', 'Multi-object tracking'],
    action: proposal('הציעו שיפור למעקב', 'מכירים tracker טוב יותר למצלמה מסתובבת אחת (BoT-SORT, ByteTrack…)? כתבו מה ולמה.'),
    steps: ['קראו את "איך הגענו לכאן" למעלה.', 'מפתחים: game_detect.py ו-player_tracks.py ב-video-analysis.'],
    tasks: [{ id: 'reattach', title: 'חיבור מסלולים שנקטעו לפי מראה (re-id)' }],
  },
  ball: {
    why: 'כל הסטטיסטיקה, סימון הכדור בסרטונים והשחזורים נשענים על מסלול הכדור. כשהכדור "נעלם", הכל אחריו נשבר.',
    helpWanted: true,
    skills: ['Python', 'PyTorch', 'YOLO', 'OpenCV', 'תיוג נתונים'],
    action: { kind: 'tool', tool: 'lab-clips', label: 'תייגו כדור בקליפ', hint: 'פותחים קליפ, עוברים פריים-פריים ולוחצים על הכדור האמיתי (או "אין כדור"). כל תיקון נשמר כתווית אימון.' },
    steps: [
      'פתחו קליפ מסטטוס "לבדיקה" ותקנו 50–100 פריימים שבהם ה-AI טעה.',
      'קראו את video-analysis/README.md — סבבי האימון (harvest ← crops ← train ← eval).',
      'רוצים לאמן? כתבו בשרשור — האימון רץ על kookisnooki (RTX 4050), לא צריך GPU משלכם.',
    ],
    tasks: [
      { id: 'tag-dark-ball', title: 'לתייג קליפים ממגרש עם כדור כהה (קריית מוצקין)' },
      { id: 'holdout-venue', title: 'להרכיב holdout רב-מגרשי (3 מגרשים, 300 פריימים)' },
      { id: 'tiny-model', title: 'לבדוק מודל קטן (YOLO11n) שירוץ בזמן אמת בטלפון' },
    ],
  },
  rink: {
    why: 'בלי כיול אין מהירויות, אין מרחקי בעיטה ואין שחזור תלת-ממד. כל מגרש וכל מצלמה צריכים כיול משלהם.',
    helpWanted: true,
    skills: ['עין חדה', 'גאומטריה', 'Python', 'OpenCV'],
    action: { kind: 'tool', tool: 'lab-rink', label: 'הקישו נקודות מגרש', hint: 'פותחים ערכה, בוחרים נקודת ציון בתרשים ומקישים עליה בתמונה (עם זכוכית מגדלת). "חשב מידות" מחזיר את ההתאמה תוך שניות.' },
    steps: [
      'פתחו ערכה ממתינה והקישו לפחות 4 נקודות בכל פריים.',
      'לחצו "חשב מידות" — נקודה אדומה (מעל 0.5 מ׳) כנראה הוקשה במקום הלא נכון.',
      'מפתחים: rink_geom.py ו-rink_points.py — הצעד הבא הוא מיני-מפה מלמעלה.',
    ],
    tasks: [
      { id: 'minimap', title: 'מיני-מפה מלמעלה + קווי מגרש על הווידאו לבדיקה ויזואלית' },
      { id: 'new-venue', title: 'ערכת כיול למגרש נוסף' },
      { id: 'auto-calib', title: 'כיול אוטומטי מזיהוי קווים, בלי הקשות' },
    ],
  },
  pose: {
    why: 'התנוחה נותנת את להב המקל — וזה מה שהעלה את מנוע האירועים מ-0.618 ל-0.651. היא גם השלד של כל שחקן בתלת-ממד.',
    skills: ['Pose estimation', 'Python', 'ONNX'],
    action: { kind: 'tool', tool: 'scene3d', label: 'צפו בשלדים בתלת-ממד', hint: 'פתחו סצנה ועברו לתצוגת "מצלמה אמיתית": השלדים צריכים לשבת על השחקנים. כתבו בשרשור רגע (mm:ss) שבו זה לא מסתדר.' },
    steps: ['צפו בסצנה אחת והשוו לווידאו.', 'מפתחים: pose_detect.py (RTMPose) ו-stick.py (להב המקל).'],
    tasks: [{ id: 'stick-detector', title: 'גלאי מקל אמיתי (keypoints של הלהב) במקום הערכה מהידיים' }],
  },
  ballpath: {
    why: 'מסלול הכדור הוא החוליה החלשה של מנוע האירועים: כשהכדור לא "מגיע" לשחקן, מסירה או חטיפה לא נספרות.',
    helpWanted: true,
    skills: ['Python', 'Tracking', 'Kalman / פיזיקה', 'Viterbi / DP'],
    action: { kind: 'experiment', stage: 'events', label: 'נסו הגדרות אחרות למסלול', hint: 'בניסוי של מנוע האירועים יש את כל ההגדרות של העוקב הפיזיקלי (חיכוך, רדיוס חיפוש, מהירות מכה…). kookisnooki מריץ ומשווה למצב היום תוך דקה.' },
    steps: ['קראו את "מה ניסינו" — 5 גרסאות מסלול "טובות יותר" שהורידו את התוצאה.', 'הריצו ניסוי אחד והשוו לפי סוג אירוע.', 'מפתחים: game_events.py (ball_phys, ball_v6) ו-ballpath_exp.py.'],
    tasks: [{ id: 'contact-metric', title: 'מדד מסלול שמתמקד ברגעי מגע עם המקל' }],
  },
  identity: {
    why: 'סטטיסטיקה אישית ("3 בעיטות, 2 חטיפות") דורשת לדעת מי עשה מה. זה גם מה שמכניס שמות לשחזור.',
    helpWanted: true,
    skills: ['Python', 'OCR', 'Re-ID', 'תיקון נתונים'],
    action: { kind: 'widget', widget: 'data-gaps', focus: 'jersey', label: 'מצאו חורים ברוסטר', hint: 'שחקנים בלי מספר חולצה או עמדה. מכירים אותם? כתבו את התיקון בשרשור — מספר נכון = זיהוי נכון.' },
    steps: ['עברו על הרשימה ובדקו שחקנים מהקבוצה שאתם מכירים.', 'כתבו בשרשור: שם, קבוצה, מספר נכון.', 'מפתחים: player_ids.py, jersey_track.py, player_embed.py.'],
    tasks: [
      { id: 'givat-ada-numbers', title: 'לאמת מספרי חולצה של גבעת עדה נוער מול הווידאו' },
      { id: 'jersey-ocr', title: 'לשפר OCR של מספר על הגב בתנועה' },
    ],
  },
  events: {
    why: 'אף ליגה בגודל שלנו לא מקבלת סטטיסטיקה כזאת. זה מה שיגרום לשחקנים לחזור לאתר אחרי כל משחק.',
    skills: ['Python', 'ראייה ממוחשבת', 'סטטיסטיקה', 'הכרת המשחק'],
    action: { kind: 'tool', tool: 'lab-match', label: 'סקרו אירועים מול הווידאו', hint: 'בוחרים ריצה, צופים בכל אירוע ומסמנים נכון / שגוי / לא בטוח — ומוסיפים אירועים שהמנוע פספס. זו האמת שכל ניסוי נמדד מולה.' },
    experiment: 'events',
    steps: ['פתחו ריצה וסקרו 30 אירועים — מקשים V / X / U.', 'מצאתם אירוע שהוחמץ? "פספס" מוסיף אותו בזמן הנוכחי בסרטון.', 'רוצים לשנות את המנוע? הריצו ניסוי (בצד) — דקה על kookisnooki.'],
    tasks: [
      { id: 'review-h2', title: 'לסקור את 217 האירועים של המחצית השנייה (ריצה 9a3d84d7)' },
      { id: 'stoppage', title: 'זיהוי עצירות משחק (כדור מת) כדי לא לספור מסירות שם' },
      { id: 'goal-recall', title: 'בדיקת recall מול רשימת הגולים האמיתית מטופס השיפוט' },
    ],
  },
  audio: {
    why: 'רוב הגולים מגיעים עם צעקה. השנייה המדויקת של הגול היא מה שמאפשר תקציר אוטומטי בלי שאדם יחפש אותו בסרטון.',
    skills: ['עיבוד אות', 'Python', 'Audio ML'],
    action: proposal('הציעו גישה לזיהוי מהקול', 'מסווג קול קטן, embeddings מוכנים, שילוב עם התמונה — מה הייתם מנסים, ועל איזה דאטה?'),
    steps: ['קראו את "איך הגענו לכאן".', 'מפתחים: locate_goal ב-goal_worker.py, ו-audio_2026.py.'],
    tasks: [{ id: 'audio-goal', title: 'לשפר זיהוי שניית הגול מהאודיו (69% ← 90%)' }],
  },
  report: {
    why: 'זה המוצר שהשחקנים יראו: דו״ח משחק עם החזקה, בעיטות ומפות חום, כמו בסוף משחק FIFA.',
    skills: ['React', 'ויזואליזציה', 'עיצוב מוצר'],
    action: proposal('איך הדו״ח צריך להיראות?', 'מה שחקן או מאמן היו רוצים לראות אחרי משחק? מה מיותר? איזה גרף?', ['idea', 'proposal', 'question']),
    steps: ['כתבו מה הייתם רוצים לראות אחרי משחק שלכם.', 'מפתחים: build_report.py (הנתונים ב-out/report/*.json).'],
    tasks: [{ id: 'report-page', title: 'עמוד דו״ח משחק באתר' }],
  },
  shots: {
    why: 'מאמנים שואלים "איפה השוער שלהם חלש?" ו"מאיפה השחקן הזה מבקיע?". רק בעיטות מתויגות עונות על זה.',
    helpWanted: true,
    skills: ['הכרת המשחק', 'תיוג נתונים', 'SQL', 'ויזואליזציה'],
    action: { kind: 'tool', tool: 'lab-shots', label: 'תייגו בעיטות', hint: 'פותחים קליפ, מגיעים לרגע הבעיטה ולוחצים S — כרטיס הבעיטה נפתח. לא צריך לדעת לתכנת.' },
    steps: ['בחרו קליפ, לחצו S ברגע הבעיטה ומלאו את הכרטיס.', 'סמנו את נקודת המוצא על המגרש ואת הנקודה בשער.', 'יש לכם רעיון לגרף (מפת חום, אחוז הצלה לפי אזור)? כתבו בשרשור.'],
    tasks: [
      { id: 'tag-5-games', title: 'לתייג את כל הבעיטות ב-5 משחקים' },
      { id: 'keeper-zones', title: 'עמוד אחוזי הצלה לפי אזור בשער, לכל שוער' },
      { id: 'shot-map', title: 'מפת בעיטות אישית בעמוד השחקן' },
    ],
  },
  highlights: {
    why: 'כל גול בשידור הופך לסרטון מוכן לשיתוף בתוך דקות. זה מה שמביא אנשים לאפליקציה.',
    skills: ['Python', 'ffmpeg', 'עריכת וידאו', 'עין ביקורתית'],
    action: { kind: 'widget', widget: 'rate-videos', label: 'דרגו סרטונים מהפיד', hint: 'סרטונים אמיתיים מהפיד. דירוג + משפט אחד ("ההילוך החוזר נחתך מוקדם") עוזר לכוון את goal_fx.' },
    steps: ['דרגו 5 סרטונים — מה עובד ומה לא.', 'מפתחים: goal_fx.py (הטיפול), goal_worker.py (הצינור), highlight_reel.py (התקציר השבועי).'],
    tasks: [{ id: 'notify-draft', title: 'התראה לעורכים כשטיוטה אוטומטית נוחתת' }],
  },
  scene3d: {
    why: 'זה הרגע שבו שחקן רואה את הגול שלו מאחורי השער. תוכן שאין לאף ליגה אחרת.',
    skills: ['three.js', 'React', 'Python', 'Pose estimation', 'אנימציה'],
    action: { kind: 'tool', tool: 'scene3d', label: 'צפו ודרגו שחזור', hint: 'פתחו סצנה, השוו לווידאו האמיתי (תצוגת "מצלמה אמיתית") וכתבו בשרשור מה לא נראה נכון — שחקן במקום הלא נכון, תנועה לא טבעית.' },
    steps: ['צפו בסצנה אחת בכל הזוויות.', 'כתבו בשרשור רגע (mm:ss) שבו השחזור שונה מהווידאו.', 'מפתחים: src/lib/scene3d/replay.js + skater.js; הנתונים מ-video-analysis/scene3d/export_scene.py.'],
    tasks: [
      { id: 'ball-height', title: 'גובה כדור (כרגע תמיד על הרצפה)' },
      { id: 'offscreen', title: 'לחזות שחקנים שיצאו מהפריים במקום להעלים אותם' },
      { id: 'share-clip', title: 'ייצוא סצנה לסרטון קצר לפיד' },
    ],
  },
  autofollow: {
    why: 'מצלמה ייעודית עולה אלפי שקלים. טלפון ישן על חצובה שעוקב לבד = כל משחק משודר.',
    helpWanted: true,
    skills: ['Swift', 'Kotlin', 'CoreML / TFLite', 'בדיקות שטח', 'quantization'],
    action: proposal('דו״ח בדיקת שטח', 'הייתם במשחק עם המצלמה? כתבו מה קרה: חום, סוללה, איבוד מעקב, איכות. גם רעיונות לשיפור.', ['field', 'bug', 'idea']),
    steps: ['בדיקת שטח: טלפון על חצובה 2–3 מ׳, כבל טעינה, משחק מלא.', 'מלאו דו״ח שטח כאן.', 'מפתחים: MOBILE-BUILD/AUTO-FOLLOW-SPEC.md — מתמטיקת המסגור משותפת ל-iOS ול-Android.'],
    tasks: [
      { id: 'field-test', title: 'בדיקת שטח ראשונה — משחק מלא, טלפון אחד' },
      { id: 'heat-test', title: 'מדידת חום וסוללה ב-50 דקות' },
      { id: 'int8', title: 'quantization ל-int8 ומדידת השהיה לכל מכשיר' },
    ],
  },
  faces: {
    why: 'כשקבוצת פנים מקבלת שם, כל התמונות של השחקן מופיעות אוטומטית בפיד ובעמוד שלו.',
    helpWanted: true,
    skills: ['היכרות עם השחקנים', 'Python', 'Face embeddings'],
    action: { kind: 'tool', tool: 'media', label: 'הציעו שמות לקבוצות פנים', hint: 'מזהים מישהו? כתבו שם פרטי ומשפחה. הצעות מצטברות ומנהל מאשר.' },
    steps: ['עברו על 20 קבוצות והציעו שמות למי שאתם מכירים.', 'בכלי "קבוצות תמונות" (בלשונית כלים) אפשר לאשר ולשייך לשחקן.', 'מפתחים: hockey-photos/ — CompreFace + clustering.'],
    tasks: [
      { id: 'new-albums', title: 'להריץ את הצינור על אלבומי העונה החדשה' },
      { id: 'merge-clusters', title: 'הצעת איחוד לקבוצות שהן אותו אדם' },
    ],
  },
  training: {
    why: 'כל מודל במפה טוב בדיוק כמו התוויות שלו. רוב התוויות היום ממשחק אחד וממגרש אחד.',
    skills: ['תיוג נתונים', 'PyTorch', 'MLOps'],
    action: { kind: 'tool', tool: 'lab-clips', label: 'תייגו כדור בקליפ', hint: 'כל פריים מתויג נכנס לסבב האימון הבא. קליפים ממגרשים אחרים שווים הכי הרבה.' },
    steps: ['תייגו 50 פריימים ממגרש שהוא לא קריית ביאליק.', 'מפתחים: round9_build.py / round9_run.py — כך נבנית חבילת אימון ונשלחת ל-kookisnooki.'],
    tasks: [{ id: 'multi-venue', title: 'סבב אימון רב-מגרשי' }],
  },
  measure: {
    why: 'בלי מדידה הוגנת אי אפשר לדעת אם שינוי עזר. שיפור שנראה טוב בבדיקה אחת הוריד את התוצאה 5 פעמים.',
    helpWanted: true,
    skills: ['סטטיסטיקה', 'Evaluation design', 'הכרת המשחק'],
    action: { kind: 'tool', tool: 'lab-match', label: 'סקרו אירועים — זו האמת', hint: 'כל אירוע שאתם מסמנים נכון/שגוי, וכל אירוע שאתם מוסיפים, נכנס למבחן שכל ניסוי נמדד מולו.' },
    experiment: 'events',
    steps: ['סקרו 30 אירועים, ובמיוחד הוסיפו אירועים שהמנוע פספס (זה מה שחסר הכי הרבה).', 'מפתחים: eval_review.py ו-devlab/bench_events.py (המבחן של הניסויים).'],
    tasks: [
      { id: 'blind-review', title: 'סקירה עיוורת: חלונות אקראיים בלי הצעות של מנוע' },
      { id: 'second-game', title: 'אמת ממשחק שני' },
    ],
  },
  web: {
    why: 'הבית של הליגה: טבלה, משחקים, פיד, שידורים. כל שיפור כאן רואים מאות אנשים בשבוע.',
    skills: ['React', 'Tailwind', 'עיצוב', 'נגישות', 'SQL'],
    action: proposal('דווחו באג או הציעו שיפור', 'מה מעצבן, מה חסר, מה נשבר בטלפון. עם קישור לעמוד — אפילו טוב יותר.'),
    steps: ['גלשו באתר מהטלפון ודווחו על כל דבר שנראה שבור.', 'מפתחים: CLAUDE.md בשורש הריפו — ענפים, פריסה והמלכודות שכבר עלו לנו בזמן.'],
    tasks: [
      { id: 'a11y-pass', title: 'מעבר נגישות (קורא מסך, ניגודיות) על הדפים הראשיים' },
      { id: 'perf', title: 'שיפור טעינה ראשונה בטלפון (Lighthouse)' },
    ],
  },
  apps: {
    why: 'רוב המשתמשים בטלפון. האפליקציה היא גם המצלמה של הליגה.',
    skills: ['Swift', 'SwiftUI', 'Kotlin', 'Jetpack Compose', 'בדיקות QA'],
    action: proposal('דווחו מהאפליקציה', 'כתבו מכשיר, גרסה ומה קרה. צילום מסך? תארו במילים איפה.', ['bug', 'idea', 'question']),
    steps: ['הצטרפו לבדיקה (Android) או ל-TestFlight (iOS) — בקשו בשרשור.', 'דווחו כל באג עם מכשיר וגרסה.'],
    tasks: [
      { id: 'android-testers', title: 'להיות אחד מ-12 בודקי Android ל-14 יום' },
      { id: 'parity', title: 'פיצ׳רים שיש באתר ואין באפליקציות — רשימה' },
    ],
  },
  leaguedata: {
    why: 'כל מודל, סיפור ושחזור נשען על הנתונים בבסיס. שחקן בלי מספר = שחקן שה-AI לא יזהה.',
    skills: ['SQL', 'Postgres', 'Supabase', 'סדר וארגון'],
    action: { kind: 'widget', widget: 'data-gaps', focus: 'all', label: 'בדקו חורים בנתונים', hint: 'רשימה חיה של מה שחסר. מכירים את התשובה? כתבו בשרשור, מנהל יעדכן.' },
    steps: ['סננו לפי קבוצה ובדקו מה חסר.', 'כתבו תיקונים בשרשור (שם ← מספר / עמדה).', 'מפתחים: supabase/*.sql — players היא הטבלה היחידה עם הרשאות עמודה (לא select *).'],
    tasks: [
      { id: 'photos', title: 'תמונות פרופיל לשחקנים (photo_url ריק כמעט לכולם)' },
      { id: 'history', title: 'ייבוא תוצאות עונות קודמות לארכיון' },
      { id: 'quality-checks', title: 'בדיקות איכות לילית: box score מול כובשי השערים' },
    ],
  },
  stories: {
    why: 'עמוד משחק עם סיפור אמיתי מושך קוראים וגוגל. בלי זה עמוד משחק הוא רק תוצאה.',
    skills: ['כתיבה בעברית', 'Prompt engineering', 'TypeScript'],
    action: { kind: 'widget', widget: 'rate-stories', label: 'דרגו סיפורים שפורסמו', hint: 'קראו סיפור, דרגו 1–5 וכתבו מה לא עבד (עובדה שגויה, ניסוח רובוטי, חזרות). זה מזין את ה-prompt הבא.' },
    steps: ['דרגו 3 סיפורים.', 'מצאתם עובדה שגויה? זה הכי חשוב — כתבו אותה.', 'מפתחים: scripts/game-story/ROUTINE.md + supabase/functions/game-story.'],
    tasks: [
      { id: 'tone-guide', title: 'מדריך סגנון קצר לסיפורים (טון, אורך, מה אסור)' },
      { id: 'fact-check', title: 'בדיקה אוטומטית של כל מספר בסיפור מול box score' },
    ],
  },
  ideas: {
    why: 'הרבה מהדברים במפה התחילו ממשפט אחד בוואטסאפ. הרעיון הבא יכול להיות שלכם.',
    skills: ['כל אחד'],
    action: proposal('הציעו רעיון', 'כותרת אחת ושני משפטים: מה זה ולמה זה טוב לליגה.', ['idea', 'proposal', 'question']),
    steps: ['כתבו את הרעיון בשתי שורות.', 'אחרים מגיבים — רעיון עם תמיכה הופך לשלב משלו במפה.'],
    tasks: [],
  },
}

// Old ?topic=<id> links (the retired catalog) → the stage that absorbed it.
export const TOPIC_TO_STAGE = {
  'ball-detection': 'ball', 'match-stats': 'events', 'shot-scouting': 'shots', 'rink-calibration': 'rink',
  'scene3d': 'scene3d', 'player-id': 'identity', 'goal-highlights': 'highlights', 'auto-camera': 'autofollow',
  'broadcast': 'sources', 'game-stories': 'stories', 'face-matching': 'faces', 'data-quality': 'leaguedata',
  'web-app': 'web', 'mobile-apps': 'apps', 'new-ideas': 'ideas',
}
