// Developer check, not part of the app (only the Vite dev server serves it).
// Records from the microphone the way the interview page does, runs the browser voice analysis, and sends
// the recording, the result and the timings to models/Audio_Emotion_Analysis/browser_check.py, which
// compares them with the old service's code on the same recording.
//
//   /voice-check/?name=clip&seconds=5&report=http://127.0.0.1:PORT
import { analyzeVoice, prepareVoiceAnalysis } from "../src/lib/voice";

const params = new URLSearchParams(location.search);
const name = params.get("name") ?? "clip";
const seconds = Number(params.get("seconds") ?? 5);
const report = params.get("report");
const log = (line: string) => (document.getElementById("log")!.textContent += `\n${line}`);

const send = (path: string, body: BodyInit) =>
    report ? fetch(`${report}${path}?name=${encodeURIComponent(name)}`, { method: "POST", body }) : Promise.resolve();

let longestTask = 0;
try {
    new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) longestTask = Math.max(longestTask, entry.duration);
    }).observe({ type: "longtask" });
} catch {
    // Long task timing is Chrome-only.
}

async function record(): Promise<Blob> {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const tracks = stream.getAudioTracks();
    let mimeType = "audio/webm";
    if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = "";
    const recorder = new MediaRecorder(new MediaStream(tracks), { mimeType });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
    };
    const stopped = new Promise((resolve) => (recorder.onstop = resolve));
    recorder.start();
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
    recorder.stop();
    await stopped;
    stream.getTracks().forEach((track) => track.stop());
    return new Blob(chunks, { type: chunks[0]?.type });
}

try {
    const started = performance.now();
    prepareVoiceAnalysis();
    const recording = await record();
    log(`recorded ${recording.size} bytes of ${recording.type}`);

    longestTask = 0;
    const t0 = performance.now();
    const result = await analyzeVoice(recording);
    const analysisMs = performance.now() - t0;
    log(JSON.stringify(result, null, 1));

    await send("/recording", recording);
    await send("/result", JSON.stringify({
        result,
        analysisMs,
        longestMainThreadTaskMs: longestTask,
        totalMs: performance.now() - started,
        userAgent: navigator.userAgent,
    }));
} catch (err) {
    log(`failed: ${err}`);
    await send("/error", String(err instanceof Error ? err.stack ?? err.message : err));
}
