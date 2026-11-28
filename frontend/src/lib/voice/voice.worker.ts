// Runs the voice analysis off the main thread, so the interview stays responsive.
import { analyzePcm, type Engine } from "./analyze";
import { createModel, type ModelLayout } from "./model";
import { toServerPcm } from "./pcm";
import { createSoxr } from "./soxr";
import layoutUrl from "./assets/model3.json?url";
import weightsUrl from "./assets/model3.bin?url";
import soxrUrl from "./assets/soxr.wasm?url";

export type Message = { type: "prepare" } | { type: "analyze"; channels: Float32Array[] };
export type Request = Message & { id: number };
export type Reply = { id: number; ok: true; result?: unknown } | { id: number; ok: false; error: string };

const scope = self as unknown as {
    onmessage: ((event: MessageEvent<Request>) => void) | null;
    postMessage(message: Reply): void;
};

async function download(url: string): Promise<Response> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Could not load ${url} (${response.status})`);
    return response;
}

let engine: Promise<Engine> | null = null;

function loadEngine(): Promise<Engine> {
    engine ??= (async () => {
        const [layout, weights, wasm] = await Promise.all([
            download(layoutUrl).then((r) => r.json() as Promise<ModelLayout>),
            download(weightsUrl).then((r) => r.arrayBuffer()),
            download(soxrUrl).then((r) => r.arrayBuffer()),
        ]);
        return { soxr: await createSoxr(wasm), model: createModel(layout, weights) };
    })().catch((err) => {
        engine = null; // try again next time, for example after a network error
        throw err;
    });
    return engine;
}

scope.onmessage = async ({ data }) => {
    try {
        const loaded = await loadEngine();
        const result = data.type === "analyze" ? analyzePcm(toServerPcm(data.channels), loaded) : undefined;
        scope.postMessage({ id: data.id, ok: true, result });
    } catch (err) {
        scope.postMessage({ id: data.id, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
};
