// Voice analysis of recorded answers, in the browser. It gives the same emotions and speaking style as
// the old emotion service: same model, same audio steps (see constants.ts and the tests in __tests__).
import type { EmotionResult } from "@/types";
import { decodeRecording } from "./decode";
import type { Message, Reply } from "./voice.worker";

let worker: Worker | null = null;
let nextId = 1;
const waiting = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

function failAll(error: Error) {
    for (const pending of waiting.values()) pending.reject(error);
    waiting.clear();
}

function getWorker(): Worker {
    if (worker) return worker;
    const w = new Worker(new URL("./voice.worker.ts", import.meta.url), { type: "module" });
    w.onmessage = ({ data }: MessageEvent<Reply>) => {
        const pending = waiting.get(data.id);
        if (!pending) return;
        waiting.delete(data.id);
        if (data.ok) pending.resolve(data.result);
        else pending.reject(new Error(data.error));
    };
    w.onerror = (event) => {
        // The worker itself failed, for example because its script did not load. Start a new one next time.
        event.preventDefault();
        failAll(new Error(event.message || "The voice analysis worker failed"));
        w.terminate();
        if (worker === w) worker = null;
    };
    worker = w;
    return w;
}

function send<T>(message: Message, transfer: Transferable[] = []): Promise<T> {
    const id = nextId++;
    return new Promise<T>((resolve, reject) => {
        waiting.set(id, { resolve: resolve as (value: unknown) => void, reject });
        getWorker().postMessage({ ...message, id }, transfer);
    });
}

/** Loads the model and the resampler in the background, so the first answer does not wait for them. */
export function prepareVoiceAnalysis(): void {
    send({ type: "prepare" }).catch((err) => console.warn("Voice analysis could not be loaded:", err));
}

/** Analyses one recorded answer. Rejects if the recording cannot be decoded or the analysis fails. */
export async function analyzeVoice(recording: Blob): Promise<EmotionResult> {
    const channels = await decodeRecording(recording);
    return send<EmotionResult>({ type: "analyze", channels }, channels.map((c) => c.buffer));
}

/** Stops the worker and frees its memory. A later call starts a new one. */
export function releaseVoiceAnalysis(): void {
    failAll(new Error("Voice analysis was stopped"));
    worker?.terminate();
    worker = null;
}
