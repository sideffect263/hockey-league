#!/usr/bin/env python3
"""4K game recorder — runs on an always-on machine at home (kookisnooki; the Mac as backup), saves the ORIGINAL quality of every app broadcast.

Cloudflare plays and records broadcasts at ≤1080p, but relays the phone's original stream
untouched over RTMPS playback. This pulls it with `ffmpeg -c copy` (no re-encode, ~3% CPU)
for every broadcast that's on air, so a 4K phone gives a 4K file — nothing saved on the phone.

  stream-recorder (edge fn, token-gated) → which inputs are live + their playback URL/key
  every POLL seconds: start an ffmpeg pull per connected input, restart it if it dies while
  the input is still live; when the input goes quiet, join the pieces into one MP4.

Files: ~/RinkHockeyRecordings/<game slug>/cam<N>/<HHMMSS>_<input8>.mp4
       (+ .parts/ while recording: 5-minute MPEG-TS pieces, so a crash loses seconds, not the game)
Token: ~/.config/rinkhockey/recorder.json  {"token": "..."}
Log:   stdout (the launch agent sends it to ~/Library/Logs/rinkhockey-recorder.log)

  python3 recorder.py            # run forever
  python3 recorder.py --once     # one poll (for testing)
"""
import json, os, re, shutil, signal, subprocess, sys, threading, time, urllib.request
from datetime import datetime
from pathlib import Path

ENDPOINT = "https://slpwwoupbbxcgjivcspv.supabase.co/functions/v1/stream-recorder"
ROOT = Path(os.environ.get("RECORDER_ROOT", Path.home() / "RinkHockeyRecordings"))
TOKEN_FILE = Path.home() / ".config/rinkhockey/recorder.json"
FFMPEG = shutil.which("ffmpeg") or "/opt/homebrew/bin/ffmpeg"
POLL = 3             # seconds between polls (a broadcast's first seconds are lost until the next poll)
STALL = int(os.environ.get("RECORDER_STALL", 8))  # no new bytes this long while on air → restart the pull
QUIET_FINISH = int(os.environ.get("RECORDER_QUIET", 90))    # input gone/disconnected this long → the broadcast is over, join the parts
SEGMENT = int(os.environ.get("RECORDER_SEGMENT", 300))        # seconds per piece
MIN_FREE_GB = 15     # below this, don't start new recordings


def log(*a):
    print(datetime.now().strftime("%Y-%m-%d %H:%M:%S"), *a, flush=True)


def token():
    return json.loads(TOKEN_FILE.read_text(encoding="utf-8"))["token"]


def fetch_streams():
    req = urllib.request.Request(ENDPOINT, data=b"{}", method="POST",
                                 headers={"x-recorder-token": token(), "content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.load(r)["streams"]


def free_gb():
    ROOT.mkdir(parents=True, exist_ok=True)
    return shutil.disk_usage(ROOT).free / 1e9


def safe(s):
    return re.sub(r'[\\/:*?"<>|]+', "-", s or "game").strip() or "game"


class Session:
    """One continuous pull of one live input. A restart after a drop is a new session."""

    def __init__(self, s):
        self.input = s["input"]
        # The slug already starts with the game's date (2027-05-30-בדיקה-א-נגד-בדיקה-ב).
        game_dir = ROOT / safe(s.get("slug") or s["gameId"]) / f"cam{s.get('cameraNo') or 1}"
        stamp = datetime.now().strftime("%H%M%S")
        self.name = f"{stamp}_{self.input[:8]}"
        self.final = game_dir / f"{self.name}.mp4"
        self.parts = game_dir / ".parts" / self.name
        self.parts.mkdir(parents=True, exist_ok=True)
        url = s["playUrl"] + s["playKey"]
        # stdin stays open: "q" on it is ffmpeg's clean stop on every OS (SIGINT isn't on Windows).
        cmd = [FFMPEG, "-hide_banner", "-loglevel", "error",
               "-rw_timeout", "8000000", "-i", url,
               "-map", "0", "-c", "copy",
               "-f", "segment", "-segment_time", str(SEGMENT), "-segment_format", "mpegts",
               "-reset_timestamps", "0", str(self.parts / "%04d.ts")]
        self.errlog = open(self.parts / "ffmpeg.log", "ab")
        self.proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=self.errlog)
        self.bytes = 0
        self.grew_at = time.time()
        log(f"▶ recording {s.get('slug')} cam{s.get('cameraNo')} input {self.input[:8]} → {self.final.parent}")

    def alive(self):
        return self.proc.poll() is None

    def stalled(self, now):
        """True when nothing new has arrived for STALL seconds. A pull can hang without exiting:
        on 2026-10-27 the phone switched 4K→1080p mid-broadcast (heat step-down), ffmpeg sat on
        the dead connection for ~25 s and the next attempt got nothing — ~40 s of the game lost."""
        size = sum(p.stat().st_size for p in self.parts.glob("*.ts"))
        if size > self.bytes:
            self.bytes, self.grew_at = size, now
        return now - self.grew_at >= STALL

    def stop(self, hung=False):
        if self.alive() and hung:  # a hung pull may not read "q" until its network timeout
            self.proc.kill()
            self.proc.wait()
        if self.alive():
            try:
                self.proc.stdin.write(b"q")
                self.proc.stdin.flush()
            except OSError:
                pass
            try:
                self.proc.wait(timeout=20)
            except subprocess.TimeoutExpired:
                self.proc.kill()
        self.errlog.close()

    def finish(self, hung=False):
        """Join the pieces into one MP4 (stream copy). Keeps the pieces if the join fails."""
        self.stop(hung)
        pieces = sorted(p for p in self.parts.glob("*.ts") if p.stat().st_size > 0)
        if not pieces:
            log(f"✗ {self.name}: nothing received")
            shutil.rmtree(self.parts, ignore_errors=True)
            return
        lst = self.parts / "list.txt"
        # UTF-8 explicitly: the game slug is Hebrew, and Windows' default (cp1252) can't write it.
        lst.write_text("".join(f"file '{p}'\n" for p in pieces), encoding="utf-8")
        tmp = self.final.with_suffix(".joining.mp4")

        def join(streams):
            return subprocess.run([FFMPEG, "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
                                   "-f", "concat", "-safe", "0", "-i", str(lst),
                                   "-map", streams, "-c", "copy", "-movflags", "+faststart", str(tmp)],
                                  capture_output=True, text=True)
        r = join("0")
        note, first_err = "", r.stderr.strip()[-200:]
        if r.returncode != 0:  # a broken audio track must not cost the video (the AI needs the picture)
            r2 = join("0:v")
            if r2.returncode == 0:
                note, r = " — VIDEO ONLY, audio was unreadable", r2
        if r.returncode == 0 and tmp.exists() and tmp.stat().st_size > 0:
            tmp.rename(self.final)
            if note:
                log(f"! {self.name}: full join failed ({first_err}); pieces kept in {self.parts}")
            else:
                shutil.rmtree(self.parts, ignore_errors=True)
            log(f"✓ saved {self.final} ({self.final.stat().st_size / 1e9:.2f} GB){note}")
        else:
            tmp.unlink(missing_ok=True)
            log(f"✗ join failed for {self.name}, pieces kept in {self.parts}: {r.stderr.strip()[-300:]}")


def main(once=False):
    log(f"recorder up — saving to {ROOT}, {free_gb():.0f} GB free")
    sessions = {}   # input uid -> Session
    quiet = {}      # input uid -> first time seen not connected (while we hold a session)
    stopping = False

    def on_term(*_):
        nonlocal stopping
        stopping = True
    signal.signal(signal.SIGTERM, on_term)
    signal.signal(signal.SIGINT, on_term)

    while not stopping:
        try:
            streams = {s["input"]: s for s in fetch_streams()}
        except Exception as e:
            log(f"poll failed: {e}")
            streams = None

        if streams is not None:
            now = time.time()
            for uid, s in streams.items():
                if not (s["connected"] and s["playUrl"] and s["playKey"]):
                    continue
                quiet.pop(uid, None)
                sess = sessions.get(uid)
                if sess and sess.alive() and not sess.stalled(now):
                    continue
                if sess:  # the pull died or hung while the phone is still on air: close that piece, start a new one
                    hung = sess.alive()
                    log(f"↻ pull for {uid[:8]} {'got nothing for %ds' % STALL if hung else 'stopped'} while live, restarting")
                    sess.stop(hung)
                    # Join the old piece in the background: a long one takes a while, and the new
                    # pull must start now, not after it.
                    threading.Thread(target=sess.finish, daemon=False).start()
                if free_gb() < MIN_FREE_GB:
                    log(f"✗ only {free_gb():.0f} GB free, NOT recording {s.get('slug')}")
                    sessions.pop(uid, None)
                    continue
                sessions[uid] = Session(s)

            for uid in list(sessions):
                s = streams.get(uid)
                if s and s["connected"]:
                    continue
                first = quiet.setdefault(uid, now)
                if now - first >= QUIET_FINISH:
                    sessions.pop(uid).finish()
                    quiet.pop(uid, None)

        if once:
            break
        for _ in range(POLL):
            if stopping:
                break
            time.sleep(1)

    for sess in sessions.values():
        sess.finish()
    log("recorder down")


if __name__ == "__main__":
    main(once="--once" in sys.argv)
