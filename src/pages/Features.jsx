import { Globe, Smartphone, Wrench } from "lucide-react"
import { Person as UserCircle, Squad as Users, EditIcon as PenLine, Comment as MessageSquareText, Star, Trophy, Crown } from "@/components/icons/BrandIcons"
import { Player, Whistle } from "@/components/icons/HockeyIcons"
import { useSeasonName } from "@/App"

/**
 * Public feature guide (/guide) — "what can you do in the system", organised by
 * role and tagged per platform (web / mobile app). Doubles as a testing &
 * feedback drive: it invites users to report anything that's broken or could be
 * better, and lists what we already know isn't finished yet.
 *
 * Pure content page — no data fetching. Uses the app's design tokens so it
 * inherits light/dark theming and RTL automatically.
 */

// web/app flags per feature; `note` is an optional caveat shown under the title.
const TIERS = [
  {
    num: "01", label: "פתוח לכולם — ללא הרשמה",
    roles: [{
      id: "everyone", Icon: Globe, title: "כל הגולשים",
      who: "אין צורך בחשבון. כל מי שנכנס לאתר או פותח את האפליקציה יכול לצפות בכל אלה.",
      feats: [
        { t: "המגרש — עמוד הבית (פיד)", d: "פוסטים, תמונות, כרטיסי תוצאות, ברכות יום הולדת לשחקנים, ופריוויו לקראת כל מחזור", web: true, app: true },
        { t: "חדשות הוקי גלגיליות מהעולם", d: "כתבות מליגות אירופה ודרום אמריקה, מתורגמות לעברית, ישר בפיד", web: true, app: true },
        { t: "טבלת הליגה ופלייאוף", d: "דירוג הקבוצות לפי משחקי הליגה, ועץ הפלייאוף שנפתח כשהמקום הראשון מובטח", web: true, app: true },
        { t: "לוח המשחקים", d: 'משחקים קרובים ותוצאות עבר, כולל באנר "משחק חי עכשיו"', web: true, app: true },
        { t: "לוח שנה + הוספה ליומן", d: "תצוגת לוח שנה של העונה, ומנוי ליומן (Google / iPhone) שמתעדכן לבד כשמשחק זז", note: "באפליקציה: רשימת משחקים בלבד", web: true, app: false },
        { t: "עמוד משחק חי", d: 'לוח תוצאות עם שעון רץ, "מהלך המשחק" (שערים וכרטיסים בזמן אמת), סטטיסטיקות וגרפים', web: true, app: true },
        { t: "לוח תוצאות למסך טלוויזיה", d: "תצוגה נקייה של הסמלים, התוצאה והשעון — מחברים מחשב לטלוויזיה באולם", web: true, app: false },
        { t: "צפייה בשידור וידאו חי", d: "שידור חי של המשחק, וצפייה חוזרת בשידורים שהוקלטו", web: true, app: true },
        { t: "סטטיסטיקות הליגה", d: "מלך השערים, מובילי הליגה וגרפים", web: true, app: true },
        { t: "קבוצות", d: "רשימת הקבוצות + עמוד קבוצה עם סגל, סמל ופרטים", web: true, app: true },
        { t: "שחקנים", d: "רשימת השחקנים + עמוד שחקן עם סטטיסטיקות, כרטיס אישי ותג OG לשחקני הליגה הוותיקים", web: true, app: true },
        { t: "טורנירים (נוער)", d: "לוח משחקים, טבלה ושלבים לקטגוריות U19/U17/U15", web: true, app: true },
        { t: "מדיה — וידאו ואלבומי תמונות", d: "סרטוני משחקים וגלריית תמונות עם זיהוי שחקנים אוטומטי", web: true, app: true },
        { t: "ארכיון עונות קודמות", d: "תוצאות, טבלאות וסטטיסטיקות שחקנים של עונות שהסתיימו", web: true, app: true },
        { t: "ליגיונר על גלגלים", d: "משחק קריירה: מתחילים כשחקן צעיר ובונים קריירה בהוקי גלגיליות העולמי", web: true, app: false },
        { t: "קישורים בעברית ותצוגה מקדימה", d: "כתובות כמו /players/שם-השחקן, וקישור לשחקן/קבוצה/משחק נפתח יפה ב-WhatsApp ובפייסבוק", web: true, app: false },
        { t: "עברית מלאה + מצב כהה", d: "כל הממשק בעברית, כולל תצוגה כהה", web: true, app: true },
      ],
    }],
  },
  {
    num: "02", label: "משתמשים רשומים",
    roles: [
      {
        id: "member", Icon: UserCircle, title: "משתמש רשום",
        who: "נרשמים בחינם עם אימייל, Google או Apple. ההרשמה פותחת את הפעולות החברתיות, ההתראות וסטופר מרקט.",
        feats: [
          { t: "הרשמה והתחברות", d: "אימייל וסיסמה, Google, ו-Apple", note: "התחברות עם Apple — באתר וב-iPhone (לא באנדרואיד)", web: true, app: true },
          { t: "שכחתי סיסמה / איפוס במייל", d: "קישור איפוס נשלח לאימייל", web: true, app: true },
          { t: "לייקים, תגובות ותגובות רגש", d: "אינטראקציה עם פוסטים בפיד ועם כרטיסי משחק", web: true, app: true },
          { t: "כתיבת פוסטים בפיד", d: "שיתוף טקסט ותמונות במגרש", web: true, app: true },
          { t: "פיד מותאם אישית", d: "הפיד לומד מה מעניין אתכם ומקדם את הקבוצות והשחקנים שלכם", web: true, app: true },
          { t: "סטופר מרקט", d: "משחק תחזיות בסטופרים וירטואליים (אין להם שווי כספי) על משחקים, אלופה ומלך השערים — עם קצבה שבועית וטבלת מובילים", web: true, app: true },
          { t: "פעמון התראות", d: "עדכונים על תוצאות, לייקים, תגובות, אישורים ועוד — וכל התראה מובילה למקום הנכון", web: true, app: true },
          { t: "התראות Push למכשיר", d: "מקבלים התראה גם כשהאתר או האפליקציה סגורים", web: true, app: true },
          { t: "מי מחובר עכשיו", d: 'מונה נוכחות חי — "מתגלגלים עכשיו", עם פילוח מחשב/נייד', web: true, app: true },
          { t: "הדף שלי — פרופיל אישי", d: "תמונת פרופיל, מצב כהה, שינוי סיסמה וחיבור שיטות התחברות", note: 'באפליקציה: מסך "החשבון שלי"', web: true, app: true },
          { t: "צ'אט אישי לחברי הליגה", d: "הודעות פרטיות (DM) בין חברי הליגה", web: true, app: false },
          { t: "דיווח על תוכן וחסימת משתמשים", d: "דיווח על פוסט לא ראוי; חסימת משתמש מוצגת באתר", web: true, app: true },
        ],
      },
      {
        id: "player", Icon: Player, title: "שחקן",
        who: 'אחרי שמשייכים את החשבון לכרטיס שחקן — דרך "הדף שלי", באישור מנהל או מאמן.',
        feats: [
          { t: "שיוך חשבון לכרטיס שחקן", d: "מחפשים את הכרטיס שלכם ומבקשים שיוך — כך נשמרת כל ההיסטוריה שלכם מעונות קודמות", web: true, app: true },
          { t: "הגשת כרטיס שחקן חדש", d: "רק למי שאין לו כרטיס בכלל — מגישים לאישור המאמן", note: "יש לכם כבר כרטיס? בקשו שיוך אליו במקום לפתוח חדש", web: true, app: true },
          { t: "הדף האישי כשחקן", d: "הסטטיסטיקות שלכם ויומן המשחקים האישי", web: true, app: true },
          { t: "הרשמה למשחק הבא", d: 'סימון "מגיע / לא מגיע" למשחק הקרוב — גם מקישור ששולחים בקבוצת הוואטסאפ', web: true, app: true },
          { t: "דיווח היעדרות", d: "פציעה, מילואים או חופשה — מדווחים על תאריכים שבהם לא תהיו זמינים, והמאמן רואה", web: true, app: true },
          { t: "אישור רפואי", d: "העלאת תמונה של אישור בריאות שנתי + מעקב תוקף. מאושר קודם על ידי המאמן ואחר כך על ידי הליגה", web: true, app: true },
          { t: "ברכת יום הולדת בפיד", d: "ביום ההולדת שלכם עולה ברכה בפיד — אפשר לכבות בהגדרות", web: true, app: true },
          { t: "תזכורות אישיות", d: "תזכורת על משחק שלא אישרתם, ועל אישור רפואי שפג או עומד לפוג", web: true, app: true },
          { t: "שיוך למספר קבוצות לפי גיל", d: "חברות בקבוצה אחת בכל קטגוריית גיל", web: true, app: false },
        ],
      },
    ],
  },
  {
    num: "03", label: "צוות מקצועי — במגרש",
    roles: [
      {
        id: "coach", Icon: Users, title: "מאמן",
        who: "תפקיד המוענק לקבוצה ספציפית — מבקשים דרך עמוד הקבוצה, ומנהל מאשר.",
        feats: [
          { t: "מסך ניהול (מוגבל לקבוצה שלכם)", d: "מרכז הניהול, מסונן לקבוצות שאתם מאמנים", web: true, app: true },
          { t: "ניהול סגל הקבוצה", d: "הוספה ועריכה של שחקנים, והוצאת שחקן מהקבוצה (הוא הופך לשחקן חופשי וההיסטוריה שלו נשמרת)", web: true, app: true },
          { t: "עריכת פרטי הקבוצה והסמל", d: "שם, עיר, מגרש בית, צבע וסמל (crest) הקבוצה", web: true, app: true },
          { t: "אישור בקשות של הקבוצה", d: "שיוך שחקנים, כרטיסי שחקן והצטרפות לקבוצה שלכם", web: true, app: true },
          { t: "אישור אישורים רפואיים", d: "שלב ראשון באישור — אחריכם הליגה מאשרת סופית", web: true, app: true },
          { t: "תמונת מצב של הסגל", d: "מעקב רפואי, הרחקות, היעדרויות, תאריכי לידה ומי מוכן לקבל התראות — לשחקני הקבוצה שלכם", web: true, app: true },
          { t: "בקשת שינוי מועד משחק", d: "מציעים כמה מועדים, הקבוצה היריבה בוחרת, ומנהל הליגה מאשר", web: true, app: true },
          { t: "עריכת סטטיסטיקות משחק", d: "עדכון תוצאה, שערים וכרטיסים למשחק", note: "עורך הסטטיסטיקות המפורט זמין באתר", web: true, app: false },
          { t: "ייצוא סגל ל-WhatsApp", d: "רשימת השחקנים שאישרו הגעה, מוכנה להדבקה בקבוצה", web: true, app: false },
          { t: "תזכורת יומית", d: "כל ערב ב-19:00 — מה עוד מחכה לאישורכם (במייל, למי שאין לו את האפליקציה)", web: true, app: true },
        ],
      },
      {
        id: "official", Icon: Whistle, title: "שופט & חובש (בעלי תפקיד במשחק)",
        who: "שופטים מפעילים את מנוע המשחק החי. חובשים ובעלי תפקיד משובצים למשחקים.",
        feats: [
          { t: "מנוע המשחק החי (שיפוט)", d: "שעון ספירה לאחור, שערים, עבירות, כרטיסים כחולים ואדומים, עונשין, פסקי זמן וצפירה", web: true, app: true },
          { t: "שידור חי של מהלך המשחק", d: "התוצאה והשעון משודרים לכל הצופים בזמן אמת", web: true, app: true },
          { t: "בחירת משחק לשיפוט", d: "בחירת משחק מרשימת השיבוצים + לוח תוצאות במסך מלא לרוחב", web: true, app: true },
          { t: "הזנת תוצאה מטופס שיפוט", d: "מצלמים את טופס השיפוט הכתוב ביד — המערכת ממלאת את התוצאה, ואתם מאשרים", web: true, app: false },
          { t: "טופס שיפוט להורדה", d: "ייצוא משחק שהסתיים כטופס השיפוט הרשמי של הליגה (Excel)", web: true, app: false },
          { t: "שעון שופט על Apple Watch", d: "סקורבורד ואימון שיפוט על השעון", note: "iPhone / Apple Watch בלבד", app: true },
          { t: "מועמדות עצמית לשיבוץ במשחק", d: "הצעת מועמדות כשופט/חובש ישירות מעמוד המשחק", web: true, app: false },
          { t: "שידור וידאו חי מהמצלמה", d: "פתיחת שידור וידאו של המשחק", note: "שידור מהאפליקציה נשמר גם כהקלטה; שידור מהאתר — חי בלבד", web: true, app: true },
        ],
      },
    ],
  },
  {
    num: "04", label: "ניהול המערכת",
    roles: [
      {
        id: "lm", Icon: Trophy, title: "מנהל ליגה",
        who: "גישת ניהול-על לכל הליגה (מלבד הרשאות מנהל־מערכת המלאות).",
        feats: [
          { t: "לוח שנה ומחולל משחקים", d: "בניית לוח העונה אוטומטית — סבב כפול בשבתות, מגרשי בית, ומודע ללוח העברי", web: true, app: false },
          { t: "ניהול טורנירים", d: "יצירה, הזמנת קבוצות, מחולל לוח משחקים וטבלאות", web: true, app: false },
          { t: "ניהול כל הקבוצות", d: "יצירה, עריכה ומחיקה של קבוצות בליגה", web: true, app: true },
          { t: "אישור כרטיסי שחקן ושיוכים", d: "אישור בקשות שיוך וכרטיסי שחקן חדשים בכל הליגה", web: true, app: true },
          { t: "אישור בקשות שינוי משחקים", d: "אישור/דחייה של בקשות מאמנים — האישור מחיל את השינוי אוטומטית", web: true, app: true },
          { t: "מעקב רפואי לכל הליגה", d: "מצב אישורי הבריאות של כל השחקנים, אישור סופי וסנכרון עם פודיום", web: true, app: true },
          { t: "תשלומים", d: "מי שילם ומי לא, לפי הנתונים מפודיום", web: true, app: true },
          { t: "הרחקות והיעדרויות", d: "הרחקות אחרי כרטיס אדום, והיעדרויות שחקנים — לכל הליגה", web: true, app: true },
          { t: "שיבוץ בעלי תפקיד", d: "שיבוץ שופטים וחובשים למשחקים", web: true, app: true },
          { t: "ניהול מגרשים", d: "רשימת האולמות והמגרשים בליגה", web: true, app: false },
        ],
      },
      {
        id: "editor", Icon: PenLine, title: "עורך תוכן",
        who: "תפקיד לניהול המדיה, התמונות והתוכן בפיד.",
        feats: [
          { t: "אזור יוצרי תוכן", d: "מרכז ייעודי לניהול תמונות, סרטונים ותוכן", web: true, app: false },
          { t: "זיהוי שחקנים בתמונות", d: "שיוך פנים לשחקנים וניהול קבוצות תמונות", web: true, app: false },
          { t: "טיפול בדיווחי תוכן", d: "מודרציה של פוסטים ותגובות שדווחו", web: true, app: false },
          { t: "הגשת אלבומים חדשים", d: "שליחת אלבום Google Photos לעיבוד וזיהוי", web: true, app: false },
        ],
      },
      {
        id: "admin", Icon: Crown, title: "מנהל מערכת",
        who: "גישה מלאה לכל כלי הניהול במערכת.",
        feats: [
          { t: "כל טאבי הניהול", d: "משחקים, לוח שנה, שחקנים, קבוצות, מאמנים, טורנירים, עונה, בקשות, מעקב רפואי, תשלומים, הרחקות, בעלי תפקיד, מגרשים, דיווחים, תפקידים ומנהלים", web: true, app: true },
          { t: "ניהול תפקידים ושיוך שחקנים", d: "הענקה ושלילה של תפקידים, ושיוך חשבון משתמש לכרטיס שחקן ישירות", web: true, app: true },
          { t: "ניהול מאמנים", d: "רשימת המאמנים של כל קבוצה — הוספה, העברה והסרה", web: true, app: false },
          { t: "משתמשי האפליקציה ואיחוד חשבונות", d: "מי מחובר מהאפליקציה, ואיחוד שני חשבונות של אותו אדם (למשל Apple + Google)", web: true, app: false },
          { t: "ניתוח משתמשים וטלמטריה", d: "מי פעיל, באילו מסכים, ואילו שגיאות קורות בפועל", web: true, app: false },
          { t: "ניהול סטופר מרקט", d: "יצירת שווקים, קביעת מועדי סגירה והכרעת תוצאות", web: true, app: false },
          { t: "ניהול מנהלים ומחיקת חשבונות", d: "הוספה/הסרה של מנהלים; מחיקת חשבון משתמש", web: true, app: true },
          { t: "מחולל פוסטרים למשחקים", d: "יצירת פוסטר גרפי לכל משחק", web: true, app: false },
          { t: "ארכוב עונה ואיפוס לעונה חדשה", d: "סגירת עונה, שמירתה בארכיון ופתיחת עונה חדשה", web: true, app: false },
          { t: "מודרציה ודיווחים", d: "טיפול בכל התוכן שדווח במערכת", web: true, app: true },
        ],
      },
    ],
  },
]

const WIP = [
  { t: "שידור וידאו מהאתר", d: "שידור שנפתח מהדפדפן הוא חי בלבד ולא נשמר. כדי שהמשחק יוקלט — שדרו מהאפליקציה." },
  { t: "לוח שנה ומנוי ליומן", d: "זמינים באתר בלבד; באפליקציה יש רשימת משחקים." },
  { t: "צ'אט אישי", d: "זמין באתר בלבד, עדיין לא באפליקציה." },
  { t: "התחברות עם Apple באנדרואיד", d: "זמינה באתר וב-iPhone; באנדרואיד מתחברים עם Google או אימייל." },
  { t: "כלי תוכן ופוסטרים", d: "אזור יוצרי התוכן, מחולל הפוסטרים וליגיונר על גלגלים — באתר בלבד." },
  { t: "ניהול מתקדם באפליקציה", d: "חלק מהכלים (עריכת סטטיסטיקות מפורטת, מחולל לוח משחקים, יצירת טורנירים, ניתוח משתמשים) עדיין רק באתר." },
]

function Platform({ web, app }) {
  return (
    <div className="flex flex-wrap gap-1.5 pt-0.5">
      {web && (
        <span className="stat-pill badge-info">
          <Globe className="w-3 h-3" /> אתר
        </span>
      )}
      {app && (
        <span className="stat-pill badge-neutral">
          <Smartphone className="w-3 h-3" /> אפליקציה
        </span>
      )}
    </div>
  )
}

function Feat({ t, d, note, web, app }) {
  return (
    <li className="flex flex-col sm:flex-row sm:items-start gap-2 sm:gap-3 py-3 border-t border-line-subtle first:border-t-0">
      <div className="flex items-start gap-3 flex-1 min-w-0">
        <span className="mt-2 w-1.5 h-1.5 rounded-full bg-brand shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <div className="font-bold text-fg-strong text-[15px]">{t}</div>
          <div className="text-sm text-fg-soft mt-0.5">{d}</div>
          {note && <div className="text-xs font-semibold text-brand-strong dark:text-brand-light mt-1">{note}</div>}
        </div>
      </div>
      <div className="ps-[18px] sm:ps-0 sm:shrink-0">
        <Platform web={web} app={app} />
      </div>
    </li>
  )
}

function RoleCard({ id, Icon, title, who, feats }) {
  return (
    <section id={id} className="card overflow-hidden mb-4 scroll-mt-20">
      <header className="flex items-start gap-3.5 p-5 pb-4">
        <span className="w-11 h-11 shrink-0 rounded-xl grid place-items-center bg-brand/10 text-brand-strong dark:text-brand-light">
          <Icon className="w-6 h-6" />
        </span>
        <div>
          <h3 className="text-xl font-black tracking-tight text-fg-strong">{title}</h3>
          <p className="text-sm text-fg-muted mt-0.5">{who}</p>
        </div>
      </header>
      <ul className="list-none m-0 px-5 pb-4">
        {feats.map((f) => <Feat key={f.t} {...f} />)}
      </ul>
    </section>
  )
}

export default function Features() {
  const seasonName = useSeasonName()
  return (
    <div dir="rtl" className="max-w-4xl mx-auto px-3 sm:px-6 py-4 sm:py-6 lg:py-8">
      {/* Header — Floodlight night band (the rink at night), one amber accent line */}
      <div className="relative overflow-hidden rounded-card p-6 sm:p-8 mb-6 text-white bg-fl-night ring-1 ring-white/10" style={{ backgroundImage: "radial-gradient(120% 90% at 85% 0%, #142133, #0B0F14)" }}>
        <div className="absolute inset-x-0 bottom-0 h-0.5 bg-fl-accent/70" />
        <div className="relative text-[13px] font-extrabold text-[#F2B233] mb-2">מדריך תכונות{seasonName && ` · עונת ${seasonName}`}</div>
        <h1 className="relative text-3xl sm:text-4xl font-black text-balance leading-tight">מה אפשר לעשות במערכת</h1>
        <p className="relative mt-2.5 text-[15px] text-white/85 max-w-2xl leading-relaxed">
          כל מה שהמערכת מציעה — מסודר לפי סוג המשתמש ולפי הפלטפורמה. השתמשו בזה כדי לדעת בדיוק מה אפשר לנסות, ואיפה.
          אם משהו לא עובד, מבלבל, או שנראה לכם שאפשר לשפר — ספרו לנו. גם המדריך הזה בשבילנו.
        </p>
        <div className="relative flex flex-wrap gap-x-5 gap-y-2 items-center mt-5 pt-4 border-t border-white/15 text-sm text-white/85">
          <span className="flex items-center gap-2">
            <span className="stat-pill bg-white/10 text-white"><Globe className="w-3 h-3" /> אתר</span>
            = אתר האינטרנט (מחשב או נייד)
          </span>
          <span className="flex items-center gap-2">
            <span className="stat-pill bg-white/10 text-slate-100"><Smartphone className="w-3 h-3" /> אפליקציה</span>
            = אפליקציית iPhone / אנדרואיד
          </span>
        </div>
      </div>

      {/* Jump nav */}
      <nav aria-label="קפיצה לפי תפקיד" className="flex flex-wrap gap-2 mb-6">
        {TIERS.flatMap((tier) => tier.roles).map((r) => (
          <a
            key={r.id}
            href={`#${r.id}`}
            className="min-h-[40px] inline-flex items-center text-sm font-bold text-fg-strong bg-surface rounded-full px-4 hover:bg-surface-inset transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fl-accent"
          >
            {r.title}
          </a>
        ))}
      </nav>

      {/* Tiers */}
      {TIERS.map((tier) => (
        <div key={tier.num}>
          <div className="flex items-center gap-3.5 mt-8 mb-4">
            <span className="fl-num text-sm text-fg-strong">{tier.num}</span>
            <h2 className="text-base font-extrabold text-fg-muted whitespace-nowrap">{tier.label}</h2>
            <span className="flex-1 h-px bg-line" />
          </div>
          {tier.roles.map((r) => <RoleCard key={r.id} {...r} />)}
        </div>
      ))}

      {/* Known / in progress */}
      <div className="flex items-center gap-3.5 mt-8 mb-4">
        <span className="fl-num text-sm text-fg-strong">05</span>
        <h2 className="text-base font-extrabold text-fg-muted whitespace-nowrap">בעבודה — ידוע לנו</h2>
        <span className="flex-1 h-px bg-line" />
      </div>
      <div className="card p-5 sm:p-6 mb-4">
        <h3 className="flex items-center gap-2 text-lg font-extrabold text-fg-strong mb-2">
          <Wrench className="w-5 h-5 text-brand" /> תכונות שעדיין לא הושלמו במלואן
        </h3>
        <p className="text-sm text-fg-muted mb-4">
          אלה דברים שאנחנו כבר מודעים אליהם ועובדים עליהם — אין צורך לדווח עליהם שוב. אם נתקלתם בבעיה מעבר לאלה, נשמח שתספרו.
        </p>
        <ul className="list-none m-0 p-0">
          {WIP.map((w) => (
            <li key={w.t} className="flex items-start gap-3 py-3 border-t border-line-subtle first:border-t-0">
              <span className="stat-pill badge-warning shrink-0 mt-0.5">בפיתוח</span>
              <div className="text-sm text-fg-soft">
                <b className="text-fg-strong font-bold">{w.t}:</b> {w.d}
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* How to test + feedback */}
      <div className="flex items-center gap-3.5 mt-8 mb-4">
        <span className="fl-num text-sm text-fg-strong">06</span>
        <h2 className="text-base font-extrabold text-fg-muted whitespace-nowrap">איך לבדוק ואיך לתת פידבק</h2>
        <span className="flex-1 h-px bg-line" />
      </div>

      <div className="card p-5 sm:p-6 mb-4">
        <h3 className="flex items-center gap-2 text-lg font-extrabold text-fg-strong mb-3">
          <Star className="w-5 h-5 text-brand" /> טיפים לבדיקה
        </h3>
        <ol className="list-decimal pr-5 space-y-2 text-fg-soft text-[15px]">
          <li><b className="text-fg-strong">מתחילים בלי חשבון</b> — כנסו לאתר או לאפליקציה ועברו על כל מה שב"פתוח לכולם".</li>
          <li><b className="text-fg-strong">נרשמים</b> (אימייל / Google / Apple) כדי לבדוק לייקים, תגובות, פוסטים, התראות וסטופר מרקט.</li>
          <li><b className="text-fg-strong">משחקים בליגה?</b> חפשו את כרטיס השחקן שלכם ובקשו שיוך — אל תפתחו כרטיס חדש, אחרת ההיסטוריה שלכם תישאר על הכרטיס הישן.</li>
          <li><b className="text-fg-strong">רוצים לבדוק תפקיד?</b> בקשו ממנהל המערכת להעניק לכם תפקיד (שחקן / מאמן / שופט וכו') — הוא נכנס לתוקף מיד.</li>
          <li><b className="text-fg-strong">מריצים משחק חי</b> — כשופט, פתחו "שיפוט", בחרו משחק והפעילו את השעון; פתחו את עמוד המשחק במכשיר אחר כדי לראות את השידור החי.</li>
          <li><b className="text-fg-strong">בודקים את שתי הפלטפורמות</b> — חלק מהתכונות זהות באתר ובאפליקציה, וחלק ייחודיות לאתר. שימו לב לתגית שליד כל תכונה.</li>
        </ol>
      </div>

      <div className="card p-5 sm:p-6 mb-4">
        <h3 className="flex items-center gap-2 text-lg font-extrabold text-fg-strong mb-2">
          <MessageSquareText className="w-5 h-5 text-brand" /> מצאתם באג, רעיון, או שמשהו יכול לעבוד טוב יותר?
        </h3>
        <p className="text-sm text-fg-muted mb-3">
          אנחנו רוצים לשמוע הכל — לא רק תקלות. אם משהו לא עובד, מרגיש מבלבל, או שנראה לכם שאפשר לשפר אותו — זה בדיוק מה שאנחנו מחפשים.
        </p>
        <ul className="list-disc pr-5 space-y-2 text-fg-soft text-[15px]">
          <li>רשמו מה עשיתם, מה קרה ומה ציפיתם שיקרה — ואם אפשר, צרפו צילום מסך.</li>
          <li>ציינו את הפלטפורמה: <b className="text-fg-strong">אתר</b> (מחשב/דפדפן) או <b className="text-fg-strong">אפליקציה</b> (iPhone / אנדרואיד), ואת הגרסה.</li>
          <li>שלחו למנהל הליגה כדי שנוכל לתקן במהירות.</li>
        </ul>
      </div>

      <p className="text-center text-sm text-fg-muted mt-8 mb-2 leading-relaxed">
        המערכת מתעדכנת כל הזמן — לעיתים תכונה חדשה מופיעה קודם באתר ורק אחר כך באפליקציה.
        <br />
        אם משהו לא מופיע אצלכם באפליקציה, ודאו שהיא מעודכנת לגרסה האחרונה.
      </p>
    </div>
  )
}
