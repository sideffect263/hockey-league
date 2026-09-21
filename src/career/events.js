/**
 * The dilemma deck.
 *
 * These are what stop the game from being an offer treadmill, and they are
 * where the Israeli rink hockey twist actually lives. The original game we
 * studied fills this slot with generic football-agent drama; ours is specific
 * — army service at 18, a seven-club league, flying yourself to a trial in
 * Porto, holding a job because the league doesn't pay. Anyone who has played
 * in this league should recognise every one of these.
 *
 * Shape: each option has a probability `p` of the good branch. Both branches
 * carry `effects` folded into the player by the engine. An option with no `p`
 * always takes `good` — use that for the safe, boring choice, which should
 * genuinely be the right call often enough that it isn't a trap.
 *
 * `when(state, club)` gates a card to the moment it makes sense.
 */

export const EVENTS = [
  {
    id: 'army',
    when: (s) => s.player.age >= 18 && s.player.age <= 21 && s.clubHistory.length > 0,
    title: 'צו ראשון',
    description:
      'המכתב הגיע. שלוש שנים שבהן רוב השחקנים בליגה פשוט נעלמים מהפרקט — ואתה צריך להחליט איך אתה עובר אותן.',
    options: [
      {
        key: 'sport-unit',
        label: 'לנסות מסלול ספורטאים מצטיינים',
        sub: 'אימונים נמשכים — אם יאשרו',
        p: 0.45,
        good: { label: 'אושר. ממשיכים להתאמן כמעט כרגיל · +3 OVR', effects: { overall: 3 } },
        bad: { label: 'הבקשה נדחתה, ושנה שלמה ירדה לטמיון · -2 OVR', effects: { overall: -2 } },
      },
      {
        key: 'serve-full',
        label: 'לשרת מלא ולהתאמן בסופי שבוע',
        sub: 'הבחירה הבטוחה — ויקר בהתפתחות',
        good: { label: 'שירות מלא. התאמנת כשיכולת, וזה מספיק כדי לא לאבד את זה · -1 OVR', effects: { overall: -1 } },
      },
      {
        key: 'abroad-now',
        label: 'לדחות ולנסות לחתום בחו״ל עכשיו',
        sub: 'מהלך מסוכן, ופותח דלתות',
        p: 0.3,
        good: { label: 'הסתדר. יצאת מוקדם, והראש כבר אירופאי · +2 OVR, +4 פוטנציאל', effects: { overall: 2, potential: 4 } },
        bad: { label: 'הבירוקרטיה ניצחה. עונה שלמה באוויר · -3 OVR', effects: { overall: -3 } },
      },
    ],
  },
  {
    id: 'trial-abroad',
    when: (s, c) => c.band === 'israel' && s.player.overall >= 54,
    title: 'טיסה על חשבונך',
    description:
      'סוכן מפורטוגל ראה קליפ שלך ומזמין אותך לשבוע אימונים. הוא לא מממן את הכרטיס, ואין הבטחות.',
    options: [
      {
        key: 'go',
        label: 'לקנות כרטיס ולטוס',
        sub: '₪4,000 מהכיס, בלי רשת ביטחון',
        p: 0.5,
        good: { label: 'הרשמת. עכשיו יודעים עליך שם · +4 פוטנציאל, +2 OVR', effects: { potential: 4, overall: 2 } },
        bad: { label: 'שבוע יפה, ואז שקט מוחלט. הכסף לא חוזר', effects: { money: -4000 } },
      },
      {
        key: 'stay',
        label: 'להישאר ולהתמקד בליגה',
        sub: 'לבנות עונה שתדבר בעצמה',
        good: { label: 'נשארת, שיחקת, והסטטיסטיקה עשתה את העבודה · +1 OVR', effects: { overall: 1 } },
      },
    ],
  },
  {
    id: 'day-job',
    when: (s, c) => ['israel', 'entry'].includes(c.band) && s.player.age >= 20,
    title: 'משרה מלאה או חצי',
    description:
      'בליגה הזאת אף אחד לא חי מהוקי. יש הצעת עבודה טובה — והיא בדיוק בשעות שבהן הקבוצה מתאמנת.',
    options: [
      {
        key: 'part-time',
        label: 'חצי משרה, לשמור על האימונים',
        sub: 'פחות כסף, יותר פרקט',
        good: { label: 'פחות בבנק, אבל אתה באימון כל ערב · +2 OVR', effects: { overall: 2, money: -12000 } },
      },
      {
        key: 'full-time',
        label: 'משרה מלאה',
        sub: 'ביטחון כלכלי, פחות זמן',
        good: { label: 'המשכורת נכנסת. האימונים נהיים מה שנשאר מהיום · -1 OVR', effects: { overall: -1, money: 45000 } },
      },
    ],
  },
  {
    id: 'national-call',
    when: (s) => s.player.overall >= 58 && s.national.caps === 0,
    title: 'הטלפון מהנבחרת',
    description:
      'ישראל מדורגת 26 בעולם ויוצאת למונדיאל B. קוראים לך — וזה נופל בדיוק על שבועיים לחוצים במועדון.',
    options: [
      {
        key: 'go',
        label: 'לנסוע עם הנבחרת',
        sub: 'הכחול-לבן קודם',
        p: 0.7,
        good: { label: 'טורניר טוב, ופתאום סוכנים מאירופה יודעים את השם · +3 פוטנציאל', effects: { potential: 3 } },
        bad: { label: 'חזרת חבול ומחוץ להרכב · -2 OVR', effects: { overall: -2 } },
      },
      {
        key: 'skip',
        label: 'לוותר ולהישאר במועדון',
        sub: 'המאמן יעריך את זה',
        good: { label: 'המאמן זוכר את זה, והמקום בהרכב מובטח · +1 OVR', effects: { overall: 1 } },
      },
    ],
  },
  {
    id: 'club-folds',
    when: (s, c) => c.band === 'israel' || c.band === 'entry',
    title: 'המועדון בצרות',
    description: 'התקציב נגמר באמצע העונה. האולם עדיין פתוח, אבל אף אחד לא מבטיח שיהיה ליגה בשנה הבאה.',
    options: [
      {
        key: 'stay-loyal',
        label: 'להישאר ולסחוב את העונה',
        sub: 'נאמנות עולה משהו',
        p: 0.55,
        good: { label: 'החזקתם מעמד, ואתה יצאת מזה מנהיג · +2 OVR', effects: { overall: 2 } },
        bad: { label: 'הקבוצה התפרקה בפברואר. חצי עונה אבודה · -2 OVR', effects: { overall: -2 } },
      },
      {
        key: 'leave',
        label: 'לחפש קבוצה אחרת מיד',
        sub: 'לא סנטימנטלי',
        good: { label: 'נחתת רך במקום אחר, בלי לאבד קצב', effects: {} },
      },
    ],
  },
  {
    id: 'language',
    when: (s, c) => !c.isIsraeli,
    title: 'החדר שאתה לא מבין',
    description: 'ההוראות בהפסקה נאמרות בשפה שאתה לא דובר. אפשר לחיות עם זה, ואפשר לעשות משהו.',
    options: [
      {
        key: 'learn',
        label: 'ללמוד את השפה ברצינות',
        sub: 'שעתיים ביום שלא הולכות לאימון',
        p: 0.75,
        good: { label: 'אחרי חצי שנה אתה בתוך הקבוצה, לא לידה · +3 OVR', effects: { overall: 3 } },
        bad: { label: 'התקדמת לאט מדי מכדי שזה ישנה משהו העונה', effects: {} },
      },
      {
        key: 'english',
        label: 'להסתדר באנגלית',
        sub: 'מה שעובד עובד',
        good: { label: 'מסתדרים. פשוט אף פעם לא לגמרי בפנים', effects: {} },
      },
    ],
  },
  {
    id: 'play-injured',
    title: 'לשחק על משככים',
    description: 'הברך תפוחה ויש פלייאוף. החובש אומר מה שהוא חייב להגיד, והמאמן מסתכל עליך.',
    options: [
      {
        key: 'play',
        label: 'לשחק',
        sub: 'עכשיו או שנה הבאה',
        p: 0.45,
        good: { label: 'שיחקת, ניצחתם, והאגדה המקומית נולדה · +2 OVR', effects: { overall: 2 } },
        bad: { label: 'הברך נסגרה לתשעה חודשים · -4 OVR, -3 פוטנציאל', effects: { overall: -4, potential: -3 } },
      },
      {
        key: 'rest',
        label: 'לשבת בחוץ',
        sub: 'הקריירה ארוכה מפלייאוף',
        good: { label: 'ישבת, הקבוצה הפסידה — והברך שלמה · +1 פוטנציאל', effects: { potential: 1 } },
      },
    ],
  },
  {
    id: 'coach-kids',
    when: (s) => s.player.age >= 22,
    title: 'לאמן את הקטנים',
    description: 'המועדון מציע לך להעביר אימוני נוער פעמיים בשבוע. זה כסף, וזה זמן.',
    options: [
      {
        key: 'yes',
        label: 'לקחת את זה',
        sub: 'כסף קטן, פרספקטיבה גדולה',
        good: { label: 'ההוראה חידדה לך את המשחק · +1 OVR', effects: { overall: 1, money: 18000 } },
      },
      {
        key: 'no',
        label: 'לסרב ולהתמקד',
        sub: 'כל האנרגיה למשחק שלך',
        good: { label: 'כל האנרגיה נשארה על הפרקט · +2 OVR', effects: { overall: 2 } },
      },
    ],
  },
  {
    id: 'stick-deal',
    when: (s) => s.player.overall >= 68,
    title: 'חוזה מקלות',
    description: 'יצרן ציוד אירופאי רוצה אותך על הקטלוג. התשלום סביר, והמקל שלהם לא המקל שלך.',
    options: [
      {
        key: 'sign',
        label: 'לחתום',
        sub: 'כסף ונראות',
        p: 0.6,
        good: { label: 'התרגלת למקל תוך חודש, והצ׳ק נכנס', effects: { money: 60000 } },
        bad: { label: 'חצי עונה של תחושה לא נכונה ביד · -2 OVR', effects: { overall: -2, money: 60000 } },
      },
      {
        key: 'decline',
        label: 'להישאר עם הציוד שלך',
        sub: 'לא נוגעים במה שעובד',
        good: { label: 'אותו מקל, אותן ידיים, אותה שליטה · +1 OVR', effects: { overall: 1 } },
      },
    ],
  },
  {
    id: 'captaincy',
    when: (s, c) => s.player.overall >= c.baseOverall + 2 && s.player.age >= 24,
    title: 'הסרט',
    description: 'המאמן רוצה לתת לך את הקפטנות. זה כבוד, וזה גם כל הלחץ של ההפסדים.',
    options: [
      {
        key: 'accept',
        label: 'לקחת את הסרט',
        sub: 'להיות זה שמדבר',
        p: 0.65,
        good: { label: 'הקבוצה נדבקה ממך · +3 OVR', effects: { overall: 3 } },
        bad: { label: 'הלחץ נדבק אליך · -1 OVR', effects: { overall: -1 } },
      },
      {
        key: 'decline',
        label: 'להשאיר את זה לוותיק',
        sub: 'רק לשחק',
        good: { label: 'בלי כותרות, בלי רעש — רק משחק', effects: {} },
      },
    ],
  },
  {
    id: 'agent',
    when: (s, c) => c.band !== 'academy' && s.player.overall >= 56,
    title: 'סוכן ראשון',
    description: 'מישהו מציע לייצג אותך מול מועדונים באירופה, תמורת אחוזים מכל חוזה.',
    options: [
      {
        key: 'sign',
        label: 'לחתום איתו',
        sub: 'דלתות שלא היו נפתחות',
        p: 0.6,
        good: { label: 'הוא באמת מכיר אנשים. ההצעות משתנות · +5 פוטנציאל', effects: { potential: 5 } },
        bad: { label: 'הוא לקח אחוזים ולא הביא כלום', effects: { money: -15000 } },
      },
      {
        key: 'self',
        label: 'לנהל את עצמך',
        sub: 'לשמור הכול',
        good: { label: 'כל שקל נשאר אצלך. גם כל שיחת טלפון', effects: {} },
      },
    ],
  },
  {
    id: 'homesick',
    when: (s, c) => !c.isIsraeli && s.player.age <= 26,
    title: 'רחוק מהבית',
    description: 'חודש שלישי בעיר זרה, בלי חברים ובלי שבת אצל ההורים. הראש לא בפרקט.',
    options: [
      {
        key: 'push',
        label: 'לסגור שיניים ולהישאר',
        sub: 'זה עובר',
        p: 0.6,
        good: { label: 'עבר. ומה שנשאר זה שחקן בוגר יותר · +3 OVR', effects: { overall: 3 } },
        bad: { label: 'לא עבר. עונה אבודה מבחינה נפשית · -2 OVR', effects: { overall: -2 } },
      },
      {
        key: 'home',
        label: 'לבקש לחזור לישראל',
        sub: 'בריאות לפני קריירה',
        good: { label: 'חזרת, והראש התנקה', effects: { overall: 1 } },
      },
    ],
  },
  {
    id: 'derby',
    when: (s, c) => c.isIsraeli,
    title: 'דרבי הצפון',
    description: 'אולם מלא, שתי קבוצות שמכירות כל שחקן אצל השנייה, ומשחק שיזכרו שנה.',
    options: [
      {
        key: 'lead',
        label: 'לקחת את המשחק על עצמך',
        sub: 'לדרוש את הכדור',
        p: 0.55,
        good: { label: 'שלושער בדרבי. בליגה הזאת זה נשאר לנצח · +3 OVR', effects: { overall: 3 } },
        bad: { label: 'ניסית יותר מדי, והלכתם הביתה עם הפסד · -1 OVR', effects: { overall: -1 } },
      },
      {
        key: 'team',
        label: 'לשחק לקבוצה',
        sub: 'התפקיד לפני הכותרת',
        good: { label: 'שני בישולים ומשחק בוגר · +1 OVR', effects: { overall: 1 } },
      },
    ],
  },
  {
    id: 'study',
    when: (s) => s.player.age >= 19 && s.player.age <= 25,
    title: 'תואר',
    description: 'ההרשמה נסגרת השבוע. הוקי לא ישלם לך פנסיה, אבל ארבע שנים זה ארבע שנים.',
    options: [
      {
        key: 'enroll',
        label: 'להירשם',
        sub: 'לבנות את מה שאחרי',
        good: { label: 'התחלת ללמוד. הקריירה תיקח קצת יותר זמן · -1 OVR', effects: { overall: -1 } },
      },
      {
        key: 'defer',
        label: 'לדחות בשנתיים',
        sub: 'הכול על ההוקי',
        good: { label: 'הכול על הפרקט, בלי תוכנית ב׳ · +2 OVR', effects: { overall: 2 } },
      },
    ],
  },
  {
    id: 'scout-euro',
    when: (s) => s.national.caps > 0,
    title: 'יציע עם מחברות',
    description: 'באליפות אירופה יושבים צופים משלוש ליגות. משחק אחד יכול להיות כל ההזדמנות.',
    options: [
      {
        key: 'showreel',
        label: 'לשחק בשביל הצופים',
        sub: 'להבליט את מה שיודעים',
        p: 0.45,
        good: { label: 'מישהו רשם את המספר שלך · +5 פוטנציאל', effects: { potential: 5 } },
        bad: { label: 'ניסית להרשים, ונראית פחות טוב ממה שאתה · -1 OVR', effects: { overall: -1 } },
      },
      {
        key: 'normal',
        label: 'לשחק את המשחק שלך',
        sub: 'בלי להשתנות',
        good: { label: 'משחק נקי ובוגר · +1 OVR, +2 פוטנציאל', effects: { overall: 1, potential: 2 } },
      },
    ],
  },
  {
    id: 'new-coach',
    title: 'מאמן חדש',
    description: 'המאמן שהביא אותך הלך. החדש מגיע עם רעיונות משלו ורשימה משלו.',
    options: [
      {
        key: 'adapt',
        label: 'להתאים את עצמך לשיטה',
        sub: 'ללמוד תפקיד חדש',
        p: 0.7,
        good: { label: 'נכנסת לשיטה, והוא סומך עליך · +2 OVR', effects: { overall: 2 } },
        bad: { label: 'התפקיד החדש פשוט לא אתה · -1 OVR', effects: { overall: -1 } },
      },
      {
        key: 'resist',
        label: 'להמשיך לשחק כמו שאתה יודע',
        sub: 'מה שהביא אותך לכאן',
        p: 0.4,
        good: { label: 'הוא התכופף אליך, כי המספרים דיברו · +3 OVR', effects: { overall: 3 } },
        bad: { label: 'ירדת לספסל לחצי עונה · -2 OVR', effects: { overall: -2 } },
      },
    ],
  },
  {
    id: 'wage-cut',
    when: (s, c) => ['strong', 'elite', 'world'].includes(c.band),
    title: 'להוריד שכר כדי להישאר',
    description: 'המועדון רוצה אותך, אבל לא במספרים של החוזה הקודם.',
    options: [
      {
        key: 'accept',
        label: 'להסכים להפחתה',
        sub: 'להישאר ברמה הזאת',
        good: { label: 'נשארת ברמה שלקח שנים להגיע אליה', effects: { money: -40000 } },
      },
      {
        key: 'refuse',
        label: 'לעמוד על המספר',
        sub: 'להסתכן בפרידה',
        p: 0.5,
        good: { label: 'הם התקפלו. החוזה נחתם כמו שהוא', effects: { money: 40000 } },
        bad: { label: 'הם לא התקפלו, והעונה התחילה בלי מועדון · -2 OVR', effects: { overall: -2 } },
      },
    ],
  },
  {
    id: 'veteran',
    when: (s) => s.player.age >= 31,
    title: 'הגוף מדבר',
    description: 'ההתאוששות לוקחת יומיים במקום יום. אפשר להילחם בזה, ואפשר להתאים את המשחק.',
    options: [
      {
        key: 'smart',
        label: 'לשחק חכם יותר',
        sub: 'פחות ריצה, יותר קריאה',
        good: { label: 'שינית את המשחק, והוא עדיין עובד · +1 OVR', effects: { overall: 1 } },
      },
      {
        key: 'grind',
        label: 'להוסיף כושר ולהילחם בזה',
        sub: 'לא מוותרים',
        p: 0.45,
        good: { label: 'הגוף נענה עוד שנה · +2 OVR', effects: { overall: 2 } },
        bad: { label: 'העומס גבה מחיר · -3 OVR', effects: { overall: -3 } },
      },
    ],
  },
]
