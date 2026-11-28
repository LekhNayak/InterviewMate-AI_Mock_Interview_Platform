"""Checks the browser voice analysis in a real browser against the old service's code.

For each WAV file, headless Chrome records it through a fake microphone on frontend/voice-check/ (same
MediaRecorder settings as the interview page) and runs the browser analysis. This script then runs
reference.py on the same recording and compares the two.

    npm run dev -w frontend                       # in another terminal, from the repository root
    .venv/Scripts/python browser_check.py recordings/   (or .venv/bin/python on macOS and Linux)

Put speech recordings (WAV) in recordings/, which git ignores. Exits with 1 if a result is off the bars
of the design: same top emotion and speaking label, probabilities within 0.001, score within 0.005.
"""
import argparse
import http.server
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
import wave

import reference

CHROME_PATHS = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
]


def find_chrome(given):
    for path in [given, os.environ.get("CHROME"), *CHROME_PATHS]:
        if path and os.path.exists(path):
            return path
    raise SystemExit("Chrome was not found. Pass --chrome PATH.")


def start_receiver(folder, received):
    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def _cors(self):
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "POST")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")

        def do_OPTIONS(self):
            self.send_response(204)
            self._cors()
            self.end_headers()

        def do_POST(self):
            url = urllib.parse.urlparse(self.path)
            name = urllib.parse.parse_qs(url.query).get("name", ["clip"])[0]
            body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
            entry = received.setdefault(name, {})
            if url.path == "/recording":
                path = os.path.join(folder, f"{name}.webm")
                with open(path, "wb") as f:
                    f.write(body)
                entry["recording"] = path
            elif url.path == "/result":
                entry.update(json.loads(body))
                entry["done"] = True
            elif url.path == "/error":
                entry["error"] = body.decode(errors="replace")
                entry["done"] = True
            self.send_response(204)
            self._cors()
            self.end_headers()

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def run_chrome(chrome, wav, page, profile, timeout, received, name):
    args = [
        chrome, "--headless=new", f"--user-data-dir={profile}", "--no-first-run", "--no-default-browser-check",
        "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", f"--use-file-for-fake-audio-capture={wav}",
        "--disable-extensions", "--disable-background-networking", "--disable-component-update", "--disable-sync", page,
    ]
    proc = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    started = time.time()
    while not received.get(name, {}).get("done") and time.time() - started < timeout:
        time.sleep(0.5)
    if os.name == "nt":
        subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"], capture_output=True)
    else:
        proc.kill()


def compare(browser, server):
    worst = 0.0
    for key in ("emotions_3", "emotions_6"):
        for cls, p in server[key]["predictions"].items():
            worst = max(worst, abs(browser[key]["predictions"][cls] - p))
    same = (browser["emotions_6"]["emotion"] == server["emotions_6"]["emotion"]
            and browser["emotions_3"]["emotion"] == server["emotions_3"]["emotion"]
            and browser["speaking_style"]["label"] == server["speaking_style"]["label"])
    score = abs(browser["speaking_style"]["score"] - server["speaking_style"]["score"])
    return same, worst, score


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("audio", help="folder of WAV files to play into the fake microphone")
    parser.add_argument("--url", default="http://localhost:8080/voice-check/", help="the check page on the Vite dev server")
    parser.add_argument("--chrome", help="path to Chrome or Chromium")
    args = parser.parse_args()

    chrome = find_chrome(args.chrome)
    wavs = sorted(pathlib.Path(args.audio).glob("*.wav"))
    if not wavs:
        raise SystemExit(f"No WAV files in {args.audio}")

    failed = False
    with tempfile.TemporaryDirectory() as folder:
        received = {}
        server = start_receiver(folder, received)
        report = f"http://127.0.0.1:{server.server_address[1]}"
        print(f"{'clip':14} {'length':>7} {'browser result':32} {'same':>5} {'max dProb':>10} {'dScore':>9} {'analysis':>9} {'longest UI task':>15}")
        for wav in wavs:
            name = wav.stem
            with wave.open(str(wav)) as w:
                seconds = round(w.getnframes() / w.getframerate() + 0.6, 1)
            page = f"{args.url}?{urllib.parse.urlencode({'name': name, 'seconds': seconds, 'report': report})}"
            profile = os.path.join(folder, f"profile-{name}")
            run_chrome(chrome, str(wav.resolve()), page, profile, seconds + 120, received, name)
            shutil.rmtree(profile, ignore_errors=True)

            entry = received.get(name, {})
            if "result" not in entry or "recording" not in entry:
                failed = True
                print(f"{name:14} FAILED: {entry.get('error', 'no result (is the dev server running?)')}")
                continue
            browser = entry["result"]
            server_result = reference.analyze_file(entry["recording"])
            same, worst, score = compare(browser, server_result)
            ok = same and worst <= 0.001 and score <= 0.005
            failed |= not ok
            summary = f"{browser['emotions_6']['emotion']} {browser['emotions_6']['confidence']:.3f} / {browser['speaking_style']['label']}"
            print(f"{name:14} {seconds:6.1f}s {summary:32} {str(same):>5} {worst:10.6f} {score:9.6f} "
                  f"{entry['analysisMs']:7.0f}ms {entry['longestMainThreadTaskMs']:13.0f}ms{'' if ok else '  <-- off the bars'}")
        server.shutdown()
        first = next((e for e in received.values() if "userAgent" in e), None)
        if first:
            print("browser:", first["userAgent"])
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
