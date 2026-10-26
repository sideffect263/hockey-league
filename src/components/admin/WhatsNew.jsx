import { useState } from "react"
import { BookOpen, Rocket, ChevronDown } from "lucide-react"
import { Sparkle as Sparkles, Warning as ShieldAlert } from "@/components/icons/BrandIcons"

/**
 * Onboarding panel at the bottom of /admin: what each role finds in the panel, how to
 * do the common jobs, the mistakes that cost data, and what's coming. Static, collapsible.
 */
export default function WhatsNew() {
  const [open, setOpen] = useState(true)

  const Section = ({ icon, title, children }) => (
    <div>
      <h3 className="flex items-center gap-2 font-bold text-sm text-slate-900 dark:text-white mb-2">{icon} {title}</h3>
      <ul className="space-y-1.5 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{children}</ul>
    </div>
  )
  const Li = ({ children }) => (
    <li className="flex gap-2"><span className="text-brand-light shrink-0">•</span><span>{children}</span></li>
  )
  const B = ({ children }) => <span className="font-semibold text-slate-900 dark:text-white">{children}</span>

  return (
    <div className="card overflow-hidden">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between gap-3 px-5 py-4 text-right">
        <span className="flex items-center gap-2 font-bold text-slate-900 dark:text-white">
          <Sparkles className="w-5 h-5 text-brand" /> מדריך לפאנל הניהול
        </span>
        <ChevronDown className={`w-5 h-5 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="px-5 pb-5 pt-1 border-t border-slate-100 dark:border-slate-700 space-y-6">
          <p className="text-sm text-slate-500 dark:text-slate-400 pt-3">
            הפאנל מציג לכל אחד רק את הלשוניות של התפקיד שלו: מאמן רואה את הקבוצה שלו, שופט את המשחקים, מנהל ליגה את כל הליגה. הנה מה יש בו ואיך משתמשים.
          </p>

          <Section icon={<Sparkles className="w-4 h-4 text-emerald-500" />} title="מה יש בפאנל">
            <Li><B>מאמן</B> — סגל הקבוצה, בקשות שיוך וכרטיסי שחקן, אישור רפואי (שלב ראשון), היעדרויות ותאריכי לידה, ותמונת מצב של הסגל: <B>מעקב רפואי</B>, <B>הרחקות</B> ו<B>מוכנות להתראות</B>.</Li>
            <Li><B>שופט</B> — לשונית <B>משחקים</B>, ומשם לוח השיפוט החי (<B>שיפוט</B> בתפריט).</Li>
            <Li><B>מנהל ליגה</B> — <B>לוח שנה</B> (מחולל משחקים לעונה), קבוצות, טורנירים, <B>בקשות</B> ו<B>בקשות משחקים</B>, מעקב רפואי (אישור סופי), <B>תשלומים</B>, הרחקות, היעדרויות, בעלי תפקיד ומגרשים.</Li>
            <Li><B>מנהל מערכת</B> — כל הלשוניות, כולל <B>מאמנים</B>, <B>תפקידים</B>, <B>משתמשי אפליקציה</B>, <B>ניתוח משתמשים</B>, <B>טלמטריה</B> ו<B>מנהלים</B>.</Li>
          </Section>

          <Section icon={<BookOpen className="w-4 h-4 text-blue-500" />} title="איך עושים — צעד אחר צעד">
            <Li><B>אישור שחקן:</B> לשונית <B>בקשות</B> ← "אישור". בקשת <B>שיוך</B> מחברת חשבון לכרטיס קיים; <B>כרטיס חדש</B> יוצר שחקן חדש.</Li>
            <Li><B>שיוך חשבון לשחקן בלי לחכות לבקשה:</B> <B>תפקידים</B> ← ליד המשתמש "שייך שחקן" ← בוחרים את הכרטיס.</Li>
            <Li><B>הוצאת שחקן מקבוצה:</B> בלשונית <B>שחקנים</B> — השחקן הופך לחופשי וכל ההיסטוריה שלו נשמרת.</Li>
            <Li><B>בניית לוח העונה:</B> <B>לוח שנה</B> ← מחולל המשחקים יוצר סבב כפול בשבתות, לפי מגרשי הבית ובלי חגים.</Li>
            <Li><B>הזנת תוצאה מטופס שיפוט:</B> בעמוד המשחק מעלים צילום של הטופס הכתוב ← המערכת ממלאת ← בודקים ומאשרים.</Li>
            <Li><B>אישור רפואי:</B> המאמן מאשר ראשון, ואז מנהל הליגה מאשר סופית ב<B>מעקב רפואי</B>.</Li>
            <Li><B>שני חשבונות לאותו אדם</B> (למשל Apple באפליקציה ו-Google באתר): <B>משתמשי אפליקציה</B> ← איחוד חשבונות. משאירים את החשבון של האפליקציה.</Li>
            <Li><B>מינוי שופט או מאמן:</B> <B>תפקידים</B> ← בוחרים משתמש ← "הוסף תפקיד". מאמנים אפשר לנהל גם מלשונית <B>מאמנים</B>.</Li>
          </Section>

          <Section icon={<ShieldAlert className="w-4 h-4 text-amber-500" />} title="חשוב לדעת">
            <Li><B>לפני שמאשרים כרטיס שחקן חדש</B> — חפשו אם כבר יש כרטיס בשם הזה. אם יש, דחו ובקשו מהשחקן לבקש <B>שיוך</B>. כרטיס כפול מפצל את השחקן לשניים, וההיסטוריה שלו נשארת על הישן.</Li>
            <Li><B>לא מוחקים שחקן שכבר שיחק</B> — מחיקה מוחקת גם את הסטטיסטיקות שלו מכל משחק. שחקן שעזב: מוציאים מהקבוצה במקום למחוק.</Li>
            <Li><B>שידור וידאו</B> — שידור מהאפליקציה נשמר כהקלטה; שידור מהאתר חי בלבד ולא נשמר.</Li>
            <Li><B>משחקי בדיקה</B> (קבוצות 🧪) גלויים רק למנהלים — לא שולחים התראות ולא נספרים בסטטיסטיקות.</Li>
          </Section>

          <Section icon={<Rocket className="w-4 h-4 text-purple-500" />} title="מה מתוכנן בהמשך">
            <Li>לוח שנה ומנוי ליומן גם באפליקציה.</Li>
            <Li>שידור וידאו מהאפליקציה בלבד, כך שכל משחק ששודר יישמר.</Li>
            <Li>כלים נוספים מהאתר יגיעו לאפליקציות (עורך סטטיסטיקות מפורט, מחולל לוח משחקים).</Li>
          </Section>
        </div>
      )}
    </div>
  )
}
