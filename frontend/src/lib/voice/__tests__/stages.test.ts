import { describe, expect, it } from "vitest";
import { fft, ifft } from "../fft";
import { modelInput } from "../mfcc";
import { speakingFeatures, speakingScore } from "../speaking";
import { to16Bit, toMono } from "../pcm";
import { fixtures, loadModel, maxAbsDiff, signal } from "./helpers";
import { lcg } from "./signals";

// Each stage on identical input, against librosa and TensorFlow (see models/Audio_Emotion_Analysis/make_fixtures.py).

describe("fft", () => {
    it("matches a direct DFT", () => {
        const n = 64;
        const noise = lcg(3);
        const xr = Float64Array.from({ length: n }, noise);
        const xi = Float64Array.from({ length: n }, noise);
        const re = xr.slice();
        const im = xi.slice();
        fft(re, im);
        for (let k = 0; k < n; k++) {
            let sr = 0;
            let si = 0;
            for (let t = 0; t < n; t++) {
                const a = (-2 * Math.PI * k * t) / n;
                sr += xr[t] * Math.cos(a) - xi[t] * Math.sin(a);
                si += xr[t] * Math.sin(a) + xi[t] * Math.cos(a);
            }
            expect(Math.abs(re[k] - sr)).toBeLessThan(1e-12);
            expect(Math.abs(im[k] - si)).toBeLessThan(1e-12);
        }
        ifft(re, im);
        expect(maxAbsDiff(re, xr)).toBeLessThan(1e-14);
        expect(maxAbsDiff(im, xi)).toBeLessThan(1e-14);
    });
});

describe("model", () => {
    const model = loadModel();
    for (const [name, expected] of Object.entries(fixtures.model)) {
        it(`matches TensorFlow on ${name}`, () => {
            let input: Float32Array;
            if (name.startsWith("random")) {
                const noise = lcg(Number(name.slice(6)));
                input = Float32Array.from({ length: 40 * 91 }, () => noise() * 300);
            } else {
                input = Float32Array.from(fixtures.mfcc[name].matrix);
            }
            expect(maxAbsDiff(model.predict(input), expected)).toBeLessThanOrEqual(1e-5);
        });
    }
});

describe("model input (MFCCs)", () => {
    for (const [name, expected] of Object.entries(fixtures.mfcc)) {
        it(`matches librosa on ${name}`, () => {
            const { matrix, frames } = modelInput(signal(name, 22050));
            expect(frames).toBe(expected.frames);
            expect(maxAbsDiff(matrix, expected.matrix)).toBeLessThanOrEqual(0.01);
        });
    }
});

describe("speaking style", () => {
    for (const [name, expected] of Object.entries(fixtures.speaking)) {
        it(`matches the server on ${name}`, () => {
            const y = signal(name, 44100);
            const f = speakingFeatures(y, 44100);
            const e = expected.features;
            expect(Math.abs(f.energy / e.energy - 1) || 0).toBeLessThanOrEqual(1e-3);
            expect(Math.abs(f.voiced_ratio - e.voiced_ratio)).toBeLessThanOrEqual(512 / y.length);
            // Within 1%, or 1e-6 Hz for values that are zero apart from rounding (a constant pitch on silence).
            const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.01 * Math.abs(b), 1e-6);
            expect(close(f.pitch_mean, e.pitch_mean), `pitch_mean ${f.pitch_mean} vs ${e.pitch_mean}`).toBe(true);
            expect(close(f.pitch_std, e.pitch_std), `pitch_std ${f.pitch_std} vs ${e.pitch_std}`).toBe(true);
            expect(Math.abs(speakingScore(f) - expected.score)).toBeLessThanOrEqual(0.005);
        });
    }
});

describe("16-bit rounding and mono", () => {
    it("rounds like ffmpeg (half to even) and clips", () => {
        const out = to16Bit(Float32Array.from([0.5 / 32768, 1.5 / 32768, -2.5 / 32768, 1.2, -1.5, 0.25]));
        expect(Array.from(out, (v) => v * 32768)).toEqual([0, 2, -2, 32767, -32768, 8192]);
    });

    it("averages channels like librosa.to_mono", () => {
        const mono = toMono([Float32Array.from([0.5, -1, 0.25]), Float32Array.from([0.25, 1, 0.25])]);
        expect(Array.from(mono)).toEqual([0.375, 0, 0.25]);
    });
});
