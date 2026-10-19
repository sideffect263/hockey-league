// Leaked-password protection (Supabase Auth → HaveIBeenPwned, Pro plan): a password that
// appears in a known data breach is refused with code 'weak_password', reasons ['pwned'].
// Matched on the code first, the English message as a fallback.
export const PWNED_PASSWORD_MSG = "הסיסמה הזו הופיעה בדליפת מידע מאתר אחר, ולכן קל לנחש אותה. בחרו סיסמה אחרת."

export function isPwnedPasswordError(err) {
  if (!err) return false
  if (err.code === "weak_password" && (!err.reasons || err.reasons.includes("pwned"))) return true
  const m = String(err.message || "").toLowerCase()
  return m.includes("pwned") || m.includes("known to be weak") || m.includes("data breach")
}
