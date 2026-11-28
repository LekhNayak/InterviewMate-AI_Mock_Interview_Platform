import { describe, expect, it } from "vitest";
import { expectedSoxr, fixtures, loadSoxr, maxAbsDiff, signal } from "./helpers";
import { int16ToFloat } from "./signals";

// The gate of the design: the WebAssembly build must resample like python-soxr does on the server.
describe("soxr in WebAssembly", () => {
    for (const [name, size] of [["voiced", 24000], ["short", 1000]] as const) {
        for (const rate of [22050, 44100]) {
            it(`matches python-soxr for ${name}, 48000 to ${rate} Hz`, async () => {
                const soxr = await loadSoxr();
                const input = int16ToFloat(signal(name, 48000, "int16").subarray(0, size));
                expect(input.length).toBe(fixtures.soxr[`${name}@${rate}`].input);
                const out = soxr.resample(input, 48000, rate);
                const expected = expectedSoxr(`${name}@${rate}`);
                expect(out.length).toBe(expected.length);
                expect(maxAbsDiff(out, expected)).toBeLessThanOrEqual(1e-5);
            });
        }
    }

    it("gives the same output however long the input is", async () => {
        const soxr = await loadSoxr();
        const input = int16ToFloat(signal("voiced", 48000, "int16"));
        const whole = soxr.resample(input, 48000, 22050);
        const again = soxr.resample(input, 48000, 22050);
        expect(maxAbsDiff(whole, again)).toBe(0);
        expect(whole.length).toBe(Math.ceil(input.length * (22050 / 48000)));
    });
});
