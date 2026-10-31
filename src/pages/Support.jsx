import { LifeBuoy } from "lucide-react"
import { Link } from "react-router-dom"

// Support page for the rinkhockeyIL apps (iOS / Android / web).
// Canonical URL: https://rinkhockeyil.com/support — the App Store "Support URL" (2026-10-26;
// it pointed at /privacy before). Keep the in-app paths here in step with the apps.
const EMAIL = "arielbiton03@gmail.com"

const FAQ = [
  ["לא מצליחים להתחבר", <>אפשר להתחבר עם דוא״ל וסיסמה, עם Google או עם Apple. שכחתם סיסמה? במסך ההתחברות לוחצים "שכחתי סיסמה" ומקבלים קישור לאיפוס בדוא״ל.</>],
  ["החשבון לא מחובר לכרטיס השחקן שלי", <>ב"החשבון שלי" בוחרים את כרטיס השחקן שלכם ושולחים בקשה; מנהל הליגה מאשר אותה. אם הכרטיס שלכם חסר או כפול, כתבו לנו.</>],
  ["הרשמה למשחקים", <>לפני כל משחק של הקבוצה מגיעה תזכורת. עונים "מגיע" או "לא מגיע" ישר מההתראה, או בעמוד המשחק באפליקציה.</>],
  ["לא מגיעות התראות", <>בדקו שההתראות של rinkhockeyIL מאושרות בהגדרות הטלפון, ושאתם מחוברים לחשבון.</>],
  ["דיווח על תוכן או חסימת משתמש", <>בכל פוסט ותגובה יש תפריט "•••" עם "דיווח על תוכן" ו"חסום משתמש". מנהלי הליגה בודקים כל דיווח.</>],
  ["מחיקת חשבון", <>ב"החשבון שלי" לוחצים "מחיקת חשבון". אפשר גם לבקש מחיקה בדוא״ל, ונטפל תוך 30 יום.</>],
  ["שידור משחק", <>בעמוד המשחק לוחצים על כפתור השידור. מי שאינו מצוות הליגה ממתין לאישור מנהל, והשידור מתחיל לבד כשהוא מאשר. מומלץ Wi‑Fi יציב.</>],
]

export default function Support() {
  return (
    <div dir="rtl" className="max-w-3xl mx-auto p-4 sm:p-6 lg:p-8">
      <div className="flex items-center gap-2.5 mb-1">
        <LifeBuoy className="w-7 h-7 text-brand" />
        <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white">תמיכה</h1>
      </div>
      <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
        אפליקציית <span className="font-semibold">rinkhockeyIL</span> (iPhone, אנדרואיד) והאתר rinkhockeyil.com
      </p>

      <div className="card p-5 sm:p-6 space-y-6 text-slate-700 dark:text-slate-200 leading-relaxed text-[15px]">
        <section>
          <h2 className="text-base font-bold text-slate-900 dark:text-white mb-2">יצירת קשר</h2>
          <p>
            לכל שאלה, תקלה או הצעה כתבו לנו:{" "}
            <a className="text-fg-strong font-bold underline underline-offset-2" href={`mailto:${EMAIL}`}>{EMAIL}</a>.
            {" "}כדי שנעזור מהר, ציינו את סוג הטלפון ומה בדיוק קרה.
          </p>
        </section>

        <section>
          <h2 className="text-base font-bold text-slate-900 dark:text-white mb-2">שאלות נפוצות</h2>
          <dl className="space-y-3">
            {FAQ.map(([q, a]) => (
              <div key={q}>
                <dt className="font-semibold text-slate-900 dark:text-white">{q}</dt>
                <dd className="mt-0.5">{a}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section>
          <h2 className="text-base font-bold text-slate-900 dark:text-white mb-2">עוד</h2>
          <ul className="list-disc pr-5 space-y-1.5">
            <li><Link className="text-fg-strong font-bold underline underline-offset-2" to="/app">הורדת האפליקציה</Link></li>
            <li><Link className="text-fg-strong font-bold underline underline-offset-2" to="/guide">מדריך לאפליקציה</Link></li>
            <li><Link className="text-fg-strong font-bold underline underline-offset-2" to="/privacy">מדיניות פרטיות</Link></li>
          </ul>
        </section>

        <hr className="border-slate-200 dark:border-slate-700" />

        <div dir="ltr" className="text-sm text-slate-500 dark:text-slate-400 space-y-2">
          <p className="font-semibold text-slate-700 dark:text-slate-300">Support (English)</p>
          <p>
            rinkhockeyIL is a community app for Israel's amateur rink hockey league; the app is in Hebrew.
            For any question or problem, email <a className="underline" href={`mailto:${EMAIL}`}>{EMAIL}</a> and
            include your phone model and what happened. You can delete your
            account in the app (My Account → Delete Account) or by email. Report or block content from the "•••"
            menu on any post or comment.
          </p>
        </div>
      </div>
    </div>
  )
}
