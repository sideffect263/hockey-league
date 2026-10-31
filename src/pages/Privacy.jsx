import { Shield } from "lucide-react"

// Privacy policy for the rinkhockeyIL apps (iOS / Android / web).
// Canonical URL: https://rinkhockeyil.com/privacy — referenced by the store
// listings and by the terms annex with איגוד הגלגליות בישראל (2026-10-18).
// The processor list here and in the annex must stay in sync.
const UPDATED = "18 באוקטובר 2026"

const PROCESSORS = [
  ["Supabase", "מסד הנתונים, אימות משתמשים (התחברות), אחסון קבצים ופונקציות שרת", "כל נתוני השירות"],
  ["Vercel", "אירוח האתר וקוד השרת שלו", "כתובת IP ופרטי הדפדפן בעת גלישה"],
  ["Cloudflare", "אחסון והזרמת וידאו, שידורים חיים, והגשת התוכן (CDN)", "סרטוני משחקים, כתובת IP בעת צפייה"],
  ["Apple", "התראות Push למכשירי iPhone והתחברות עם Apple (לבחירתך)", "מזהה מכשיר להתראות, תוכן ההתראה"],
  ["Google", "התראות Push לאנדרואיד (Firebase), התחברות עם Google (לבחירתך), Google Analytics באתר, נגן YouTube לסרטונים", "מזהה מכשיר להתראות, נתוני גלישה מצטברים באתר"],
  ["Resend", "שליחת דוא״ל מערכת (אימות הרשמה, איפוס סיסמה)", "כתובת הדוא״ל"],
  ["Podium", "מערכת הרישום של האיגוד — ממנה מסונכרנים נתוני רישום ואישורים רפואיים", "נתוני רישום של שחקנים רשומים"],
  ["Anthropic, OpenAI", "עזרה בכתיבת טיוטות סיכומי משחקים ובעיצוב גרפיקה", "נתוני ליגה ציבוריים בלבד (תוצאות, שמות, סטטיסטיקה) — לעולם לא פרטי חשבון, קשר או רפואה"],
]

export default function Privacy() {
  return (
    <div dir="rtl" className="max-w-3xl mx-auto p-4 sm:p-6 lg:p-8">
      <div className="flex items-center gap-2.5 mb-1">
        <Shield className="w-7 h-7 text-brand" />
        <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white">מדיניות פרטיות</h1>
      </div>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
        אפליקציית <span className="font-semibold">rinkhockeyIL</span> והאתר rinkhockeyil.com · עודכן לאחרונה: {UPDATED}
      </p>

      <div className="card p-5 sm:p-6 space-y-6 text-slate-700 dark:text-slate-200 leading-relaxed text-[15px]">
        <Section title="מי אנחנו">
          rinkhockeyIL (אתר, iOS ו‑Android) היא אפליקציה לקהילת הוקי הגלגליות בישראל — טבלה, משחקים,
          סטטיסטיקות, וידאו ושידורים, פיד קהילתי, וכלי ניהול ושיפוט לליגה. האפליקציה מפותחת ומופעלת על ידי
          אריאל ביטון (להלן: "המפעיל", "אנחנו"), שהוא האחראי על המידע הנאסף בה. מדיניות זו מסבירה איזה מידע
          נאסף, למה, מי רואה אותו ולמי הוא נמסר. אנו פועלים לפי חוק הגנת הפרטיות, התשמ״א‑1981, ותקנות
          הגנת הפרטיות (אבטחת מידע), התשע״ז‑2017.
        </Section>

        <Section title="מידע שאנו אוספים">
          <ul className="list-disc pr-5 space-y-1.5">
            <li><b>חשבון:</b> כתובת דוא״ל, שם תצוגה ותמונת פרופיל (אם העלית). בהתחברות עם Google או Apple — הדוא״ל והשם שהם מוסרים.</li>
            <li><b>שיוך שחקן ותפקידים:</b> שיוך החשבון לכרטיס שחקן, וכן תפקידים (מאמן, שופט, מנהל ליגה, עורך תוכן).</li>
            <li><b>תוכן שיצרת:</b> פוסטים, תמונות וסרטונים, תגובות, לייקים, תיוגים והודעות צ׳אט.</li>
            <li><b>נתוני רישום מהאיגוד (שחקנים רשומים בלבד):</b> מסונכרנים ממערכת הרישום Podium של האיגוד — שם, תאריך לידה, מספר זהות, פרטי קשר וכתובת, מועדון ומאמן, מועדי רישום, ותוקף ובדיקה של האישור הרפואי.</li>
            <li><b>אישורים רפואיים:</b> קובץ האישור הרפואי ותאריך הבדיקה, שמועלים על ידי השחקן או מסונכרנים מ‑Podium.</li>
            <li><b>טפסי שיפוט:</b> תוצאות, אירועי משחק, וחתימות השופטים והמאמנים על טופס השיפוט.</li>
            <li><b>וידאו ותמונות ממשחקים:</b> צילומים ושידורים ממשחקי הליגה, שבהם נראים שחקנים, שופטים וקהל.</li>
            <li><b>סטופר מרקט:</b> התחזיות שלך בסטופרים, שהם נקודות משחק בלבד (ללא כסף אמיתי), ויתרת הסטופרים שלך.</li>
            <li><b>שימוש ותקלות:</b> למשתמשים מחוברים — אילו פריטים בפיד הוצגו ולכמה זמן (לסידור הפיד שלך); רישום פעולות ושגיאות באפליקציה (לאיתור תקלות); סוג המכשיר וגרסת האפליקציה; יומן התראות שנשלחו.</li>
            <li><b>מכשיר:</b> מזהה להתראות Push, אם אישרת התראות.</li>
            <li><b>מנויי לוח שנה:</b> מזהה מוצפן חד‑כיווני (hash) בלבד, כדי לספור מנויים — לא כתובת IP גלויה.</li>
            <li><b>באתר בלבד:</b> Google Analytics אוסף נתוני גלישה מצטברים (עמודים, סוג מכשיר, מדינה) באמצעות עוגיות.</li>
          </ul>
          <p className="mt-2">איננו אוספים מיקום, איננו עוקבים אחריך בין אפליקציות, אין פרסומות, ואיננו מוכרים מידע לאף גורם.</p>
        </Section>

        <Section title="כיצד אנו משתמשים במידע">
          אך ורק להפעלת הליגה והשירות: התחברות, הצגת תוצאות, סטטיסטיקות ולוחות משחקים, פרסום בפיד, שליחת
          התראות, ניהול סגלים, השאלות והשתתפות, בדיקת זכאות רפואית לשחק, שיפוט ותיעוד משחקים, ברכות יום הולדת
          בפיד (ניתן לבטל ב"החשבון שלי"), סידור הפיד לפי מה שמעניין אותך, ואיתור ותיקון תקלות.
        </Section>

        <Section title="מה פומבי ומי רואה מה">
          <ul className="list-disc pr-5 space-y-1.5">
            <li><b>פומבי:</b> נתוני הליגה — קבוצות, שמות שחקנים, מספרים, תמונות, תוצאות, סטטיסטיקות, סרטונים ושידורים ממשחקים, ותוכן שפרסמת בפיד.</li>
            <li><b>רק לך:</b> פרטי החשבון, הצ׳אט שלך, נתוני הצפייה בפיד.</li>
            <li><b>רק לבעלי תפקיד:</b> נתוני רישום מהאיגוד, אישורים רפואיים ומספרי זהות גלויים רק למנהלי המערכת ולמנהל הליגה (ובחלקם למאמן הקבוצה). אישורים רפואיים נשמרים באחסון פרטי ונפתחים רק בקישור זמני.</li>
            <li>תאריך לידה אינו מוצג לאף משתמש; משמש רק לברכת יום ההולדת ולשיוך לקבוצת גיל.</li>
          </ul>
        </Section>

        <Section title="מסירת מידע לאחרים">
          <p>איננו מוכרים, משכירים או מוסרים מידע אישי לצד שלישי. החריגים היחידים:</p>
          <ol className="list-decimal pr-5 space-y-1.5 mt-2">
            <li><b>ספקי שירות שמעבדים מידע עבורנו</b> — רק כדי להפעיל את השירות, לפי הוראותינו ולא לשימושם (טבלה למטה).</li>
            <li><b>איגוד הגלגליות בישראל</b> — נציג האיגוד מחזיק הרשאת ניהול במערכת לצורך פיקוח על הליגה; נתוני הרישום מגיעים ממערכת הרישום של האיגוד.</li>
            <li><b>חובה חוקית</b> — אם נידרש לכך בצו שיפוטי או על פי דין.</li>
            <li><b>בבחירתך</b> — כשאתה משתף פוסט, מתחבר עם Google/Apple או נרשם ללוח שנה, המידע הרלוונטי עובר לשירות שבחרת.</li>
          </ol>
          <div className="overflow-x-auto mt-3">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-right bg-slate-100 dark:bg-slate-800">
                  <th className="p-2 border border-slate-200 dark:border-slate-700">ספק</th>
                  <th className="p-2 border border-slate-200 dark:border-slate-700">למה</th>
                  <th className="p-2 border border-slate-200 dark:border-slate-700">איזה מידע</th>
                </tr>
              </thead>
              <tbody>
                {PROCESSORS.map(([name, why, what]) => (
                  <tr key={name}>
                    <td className="p-2 border border-slate-200 dark:border-slate-700 font-semibold whitespace-nowrap" dir="ltr">{name}</td>
                    <td className="p-2 border border-slate-200 dark:border-slate-700">{why}</td>
                    <td className="p-2 border border-slate-200 dark:border-slate-700">{what}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2">
            חלק מהספקים מאחסנים מידע בשרתים מחוץ לישראל (בארה״ב, באירופה ובאסיה), בהתאם לתקנות הגנת הפרטיות
            (העברת מידע אל מאגרי מידע שמחוץ לגבולות המדינה). עיבוד וידאו נעשה גם על מחשבים של המפעיל עצמו.
          </p>
        </Section>

        <Section title="אבטחת מידע">
          התקשורת מוצפנת (HTTPS). הגישה לנתונים נאכפת בצד השרת בכללי הרשאות לכל שורה (Row Level Security),
          כך שכל משתמש רואה רק את מה שמותר לו. מידע רגיש (רפואי, מספרי זהות) נגיש רק לבעלי תפקיד, ופעולות
          ניהול נרשמות ביומן.
        </Section>

        <Section title="שמירת מידע ומחיקה">
          נתוני החשבון נשמרים כל עוד החשבון פעיל. ניתן למחוק את החשבון וכל התוכן שיצרת (פוסטים, תגובות, לייקים)
          ישירות מהאפליקציה: <b>החשבון שלי ← מחיקת חשבון</b>, או בפנייה אלינו בדוא״ל. נתוני ליגה ציבוריים
          (תוצאות, סטטיסטיקות, הופעה בסגל) הם חלק מתיעוד הליגה ונשמרים גם אחרי מחיקת חשבון.
        </Section>

        <Section title="הזכויות שלך">
          לפי חוק הגנת הפרטיות, זכותך לעיין במידע שנשמר עליך, לבקש לתקן מידע שגוי ולבקש למחוק מידע.
          אפשר לבטל התראות בכל עת בהגדרות המכשיר, ולבטל ברכת יום הולדת ב"החשבון שלי". לכל בקשה — פנו
          אלינו בדוא״ל ונטפל תוך 30 יום.
        </Section>

        <Section title="קטינים">
          בליגה משחקים גם קטינים. מידע על קטינים נאסף רק לצורך השתתפותם בליגה (רישום, זכאות רפואית, סגל
          ותוצאות). מומלץ להורים ללוות את השימוש של קטינים באפליקציה, והורה רשאי לפנות אלינו בכל בקשה
          הנוגעת למידע על ילדו. הצפייה בסטופר מרקט פתוחה לכולם, וחיזוי מותר רק לשחקני הליגה מגיל 18.
        </Section>

        <Section title="עוגיות (Cookies)">
          האתר משתמש באחסון מקומי בדפדפן כדי לשמור את ההתחברות וההעדפות שלך, ובעוגיות של Google Analytics
          למדידת שימוש מצטברת. נגן YouTube עשוי להציב עוגיות משלו כשמנגנים סרטון.
        </Section>

        <Section title="שינויים במדיניות">
          נעדכן את המדיניות כשהשירות משתנה; תאריך העדכון האחרון מופיע בראש העמוד. על שינוי מהותי נודיע באפליקציה.
        </Section>

        <Section title="יצירת קשר">
          לשאלות או בקשות בנוגע לפרטיות: <a className="text-fg-strong font-bold underline underline-offset-2" href="mailto:arielbiton03@gmail.com">arielbiton03@gmail.com</a>
        </Section>

        <hr className="border-slate-200 dark:border-slate-700" />

        <div dir="ltr" className="text-sm text-slate-500 dark:text-slate-400 space-y-2">
          <p className="font-semibold text-slate-700 dark:text-slate-300">Privacy Policy (English summary)</p>
          <p>
            rinkhockeyIL (web, iOS, Android) serves the Israeli rink hockey league community and is developed
            and operated by Ariel Biton, who is responsible for the data it holds. We comply with the Israeli
            Protection of Privacy Law, 1981 and its Data Security Regulations, 2017. We collect account data
            (email, display name, photo), content you post, league roles, registration data synced from the
            association's Podium system for registered players (incl. ID number, birth date, contact details,
            medical-certificate status and files), referee forms and signatures, game video, play-money market
            activity, feed impressions and app error logs, push tokens, and aggregate website analytics
            (Google Analytics). Sensitive data is visible only to administrators and the league manager.
          </p>
          <p>
            We never sell personal data and show no ads. Data is shared only with service providers that process it
            on our behalf (Supabase, Vercel, Cloudflare, Apple, Google, Resend, Podium; Anthropic and OpenAI
            receive public league data only), with the Israel Roller Skating Association's representative for
            league oversight, where required by law, or at your own choice. Some providers store data outside
            Israel. You may access, correct or delete your data; delete your account in-app (My Account → Delete
            Account) or email us. Contact: arielbiton03@gmail.com.
          </p>
        </div>
      </div>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <section>
      <h2 className="text-base font-bold text-slate-900 dark:text-white mb-2">{title}</h2>
      <div>{children}</div>
    </section>
  )
}
