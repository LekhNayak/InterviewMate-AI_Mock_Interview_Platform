import { readFileSync } from "node:fs";
import { expect } from "vitest";
import { createSoxr } from "../soxr";
import { createModel, type ModelLayout } from "../model";
import { checksum, float32Signal, int16Signal } from "./signals";

const here = (path: string) => new URL(path, import.meta.url);

export interface Fixtures {
    signals: Record<string, { length: number; checksum: number }>;
    mfcc: Record<string, { frames: number; matrix: number[] }>;
    speaking: Record<string, { features: Record<string, number>; score: number }>;
    model: Record<string, number[]>;
    pipeline: Record<string, Record<string, unknown>>;
    soxr: Record<string, { input: number; offset: number; length: number }>;
}

export const fixtures: Fixtures = JSON.parse(readFileSync(here("./fixtures/expected.json"), "utf8"));
const soxrExpected = new Float32Array(readFileSync(here("./fixtures/soxr.f32")).buffer.slice(0));

export const expectedSoxr = (key: string) => {
    const { offset, length } = fixtures.soxr[key];
    return soxrExpected.subarray(offset, offset + length);
};

/** A test signal, after checking it is bit for bit the one the Python fixtures were made from. */
export function signal(name: string, rate: number): Float32Array;
export function signal(name: string, rate: number, kind: "int16"): Int16Array;
export function signal(name: string, rate: number, kind: "float32" | "int16" = "float32"): Float32Array | Int16Array {
    const s = kind === "float32" ? float32Signal(name, rate) : int16Signal(name, rate);
    const expected = fixtures.signals[`${name}@${rate}`];
    expect(expected, `fixture for ${name}@${rate}`).toBeDefined();
    expect(s.length).toBe(expected.length);
    expect(checksum(s), `checksum of ${name}@${rate}`).toBe(expected.checksum);
    return s;
}

const bytes = (path: string) => {
    const b = readFileSync(here(path));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};

export const loadSoxr = () => createSoxr(bytes("../assets/soxr.wasm"));
export const loadModel = () =>
    createModel(JSON.parse(readFileSync(here("../assets/model3.json"), "utf8")) as ModelLayout, bytes("../assets/model3.bin"));

export const maxAbsDiff = (a: ArrayLike<number>, b: ArrayLike<number>) => {
    expect(a.length).toBe(b.length);
    let worst = 0;
    for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]));
    return worst;
};
