import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { analyzePcm, type Engine } from "../analyze";
import { toServerPcm } from "../pcm";
import { fixtures, loadModel, loadSoxr, signal } from "./helpers";
import { int16ToFloat } from "./signals";

// The whole analysis, against the old service run on the same audio saved as a 16-bit 48 kHz WAV.
// Bars from the design: same top emotion, probabilities within 0.001, same speaking label, score within 0.005.

interface Expected {
    emotions_3: { emotion: string; predictions: Record<string, number> };
    emotions_6: { emotion: string; predictions: Record<string, number> };
    speaking_style: { label: string; score: number };
}

describe("whole pipeline", () => {
    let engine: Engine;
    const worst = { probability: 0, score: 0 };

    beforeAll(async () => {
        engine = { soxr: await loadSoxr(), model: loadModel() };
    });
    afterAll(() => console.log("largest differences from the server:", worst));

    for (const [name, raw] of Object.entries(fixtures.pipeline)) {
        it(`gives the server's result for ${name}`, () => {
            expect(raw.error, `the server failed on ${name}`).toBeUndefined();
            const expected = raw as unknown as Expected;
            const samples = int16ToFloat(signal(name, 48000, "int16"));
            const pcm = toServerPcm([samples]);
            expect(pcm).toEqual(samples); // already on the 16-bit grid, so the rounding changes nothing

            const result = analyzePcm(pcm, engine);
            expect(result.emotions_6.emotion).toBe(expected.emotions_6.emotion);
            expect(result.emotions_3.emotion).toBe(expected.emotions_3.emotion);
            expect(result.speaking_style.label).toBe(expected.speaking_style.label);
            for (const key of ["emotions_3", "emotions_6"] as const) {
                for (const [cls, p] of Object.entries(expected[key].predictions)) {
                    const d = Math.abs((result[key].predictions as Record<string, number>)[cls] - p);
                    worst.probability = Math.max(worst.probability, d);
                    expect(d, `${key} ${cls}`).toBeLessThanOrEqual(0.001);
                }
            }
            const ds = Math.abs(result.speaking_style.score - expected.speaking_style.score);
            worst.score = Math.max(worst.score, ds);
            expect(ds).toBeLessThanOrEqual(0.005);
        });
    }
});
