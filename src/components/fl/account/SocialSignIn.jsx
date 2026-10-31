/**
 * The sign-in buttons of the welcome look (board OnbWelcome, web): Google first (big,
 * white), then e-mail; Apple only when the website has Apple sign-in switched on
 * (VITE_APPLE_WEB_SIGNIN). Used by the sign-in dialog and the guest header on /me.
 * Always on the night background. No phone number (Ariel).
 */
import { APPLE_WEB_ENABLED, AppleIcon } from "@/lib/appleWeb"
import { Glyph } from "./AccountKit"

export function GoogleIcon({ className = "w-[18px] h-[18px]" }) {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.6 2.4 30.1 0 24 0 14.6 0 6.4 5.4 2.6 13.2l7.9 6.2C12.3 13.3 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.5 3-2.2 5.5-4.7 7.2l7.3 5.7C43.8 37.5 46.5 31.5 46.5 24.5z" />
      <path fill="#FBBC05" d="M10.5 28.4c-.5-1.5-.8-3.1-.8-4.9s.3-3.4.8-4.9l-7.9-6.2C1 15.6 0 19.6 0 23.5s1 7.9 2.6 11.1l7.9-6.2z" />
      <path fill="#34A853" d="M24 47c6.1 0 11.3-2 15-5.5l-7.3-5.7c-2 1.4-4.7 2.3-7.7 2.3-6.3 0-11.7-3.8-13.5-9.4l-7.9 6.2C6.4 42.6 14.6 47 24 47z" />
    </svg>
  )
}

const night = "h-[50px] rounded-[14px] bg-[#161D27] border border-[#2C3644] text-white inline-flex items-center justify-center gap-2 text-[15px] font-bold hover:bg-[#1C2532] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fl-accent disabled:opacity-60"

export default function SocialSignIn({ onGoogle, onApple, onEmail, busy = false, compact = false }) {
  return (
    <div className="flex flex-col gap-2.5">
      <button type="button" onClick={onGoogle} disabled={busy}
        className={`${compact ? "h-[52px]" : "h-[54px]"} rounded-2xl bg-white text-[#1F1F1F] inline-flex items-center justify-center gap-2.5 text-[16px] font-bold hover:bg-[#F1F1F1] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fl-accent focus-visible:ring-offset-2 focus-visible:ring-offset-[#070B10] disabled:opacity-60`}>
        <GoogleIcon /> המשך עם Google
      </button>
      {APPLE_WEB_ENABLED ? (
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={onApple} disabled={busy} className={night}><AppleIcon className="w-[18px] h-[18px]" /> Apple</button>
          <button type="button" onClick={onEmail} disabled={busy} className={night}><Glyph d="mail" size={18} /> אימייל</button>
        </div>
      ) : (
        <button type="button" onClick={onEmail} disabled={busy} className={night}><Glyph d="mail" size={18} /> המשך עם אימייל</button>
      )}
    </div>
  )
}
