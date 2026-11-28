// libsoxr, the resampler librosa used on the server (res_type="soxr_hq"), compiled to WebAssembly.
// The .wasm comes from wasm-audio-resampler 2.0.0; see public/licenses/soxr/NOTICE.txt. Its own loader
// script is not used: the few functions the module needs from its host are provided here instead.

export interface Soxr {
    /** Resamples mono audio like librosa.resample(..., res_type="soxr_hq"), including its final length. */
    resample(input: Float32Array, inRate: number, outRate: number): Float32Array;
}

// Names of the module's exports and imports, from the Emscripten loader the .wasm was built with.
interface SoxrExports {
    k(): void; // __wasm_call_ctors
    l(spec: number, recipe: number, flags: number): void; // soxr_quality_spec (writes the struct at spec)
    m(spec: number, inType: number, outType: number): void; // soxr_io_spec (writes the struct at spec)
    n(inRate: number, outRate: number, channels: number, error: number, io: number, quality: number, runtime: number): number; // soxr_create
    o(resampler: number): void; // soxr_delete
    q(resampler: number, input: number, inLen: number, inDone: number, output: number, outLen: number, outDone: number): number; // soxr_process
    r(): number; // sizeof(soxr_io_spec_t)
    s(): number; // sizeof(soxr_quality_spec_t)
    t(size: number): number; // malloc
    u(pointer: number): void; // free
}

const PAGE = 65536;
const MAX_MEMORY = 2147483648;
const SOXR_FLOAT32 = 0;
const SOXR_HQ = 4;
const CHUNK = 65536; // input samples per soxr_process call; the output does not depend on it

export async function createSoxr(wasm: BufferSource): Promise<Soxr> {
    const memory = new WebAssembly.Memory({ initial: 67108864 / PAGE, maximum: MAX_MEMORY / PAGE });
    const table = new WebAssembly.Table({ initial: 44, maximum: 44, element: "anyfunc" });
    const i32 = () => new Int32Array(memory.buffer);

    const imports = {
        a: {
            a: memory,
            b: table,
            // fd_write: soxr only writes here when debugging. Report the bytes as written and drop them.
            c: (_fd: number, iov: number, iovcnt: number, written: number) => {
                const heap = i32();
                let total = 0;
                for (let i = 0; i < iovcnt; i++) total += heap[(iov + i * 8 + 4) >> 2];
                heap[written >> 2] = total;
                return 0;
            },
            d: () => 0, // fd_seek
            e: (pointer: number) => { // time
                const now = (Date.now() / 1000) | 0;
                if (pointer) i32()[pointer >> 2] = now;
                return now;
            },
            f: () => 0, // environ_get: no environment variables
            g: (count: number, size: number) => { // environ_sizes_get
                const heap = i32();
                heap[count >> 2] = 0;
                heap[size >> 2] = 0;
                return 0;
            },
            h: () => 0, // fd_close
            i: (dest: number, src: number, num: number) => { // emscripten_memcpy_big
                new Uint8Array(memory.buffer).copyWithin(dest, src, src + num);
            },
            j: (requested: number) => { // emscripten_resize_heap
                requested >>>= 0;
                const current = memory.buffer.byteLength;
                if (requested > MAX_MEMORY) return 0;
                for (const target of [Math.min(MAX_MEMORY, Math.max(requested, current * 2)), requested]) {
                    try {
                        memory.grow(Math.ceil((target - current) / PAGE));
                        return 1;
                    } catch {
                        // try the smaller size
                    }
                }
                return 0;
            },
        },
    };

    const { instance } = await WebAssembly.instantiate(wasm, imports);
    const x = instance.exports as unknown as SoxrExports;
    x.k();

    const resample = (input: Float32Array, inRate: number, outRate: number): Float32Array => {
        // librosa.resample: soxr's output, then fix_length to ceil(n * ratio).
        const wanted = Math.ceil(input.length * (outRate / inRate));
        const result = new Float32Array(wanted);
        if (inRate === outRate) {
            result.set(input);
            return result;
        }

        const io = x.t(x.r());
        const quality = x.t(x.s());
        const error = x.t(4);
        const inDone = x.t(4);
        const outDone = x.t(4);
        const outCapacity = Math.ceil(CHUNK * (outRate / inRate)) + 4096;
        const inBuffer = x.t(CHUNK * 4);
        const outBuffer = x.t(outCapacity * 4);
        let resampler = 0;
        try {
            x.m(io, SOXR_FLOAT32, SOXR_FLOAT32);
            x.l(quality, SOXR_HQ, 0);
            resampler = x.n(inRate, outRate, 1, error, io, quality, 0);
            if (!resampler || i32()[error >> 2] !== 0) throw new Error("soxr_create failed");

            let written = 0;
            const collect = () => {
                const produced = i32()[outDone >> 2];
                const take = Math.min(produced, wanted - written);
                if (take > 0) result.set(new Float32Array(memory.buffer, outBuffer, take), written);
                written += Math.max(take, 0);
                return produced;
            };

            for (let offset = 0; offset < input.length;) {
                const chunk = input.subarray(offset, Math.min(offset + CHUNK, input.length));
                new Float32Array(memory.buffer, inBuffer, chunk.length).set(chunk);
                let consumed = 0;
                while (consumed < chunk.length) {
                    if (x.q(resampler, inBuffer + consumed * 4, chunk.length - consumed, inDone, outBuffer, outCapacity, outDone)) {
                        throw new Error("soxr_process failed");
                    }
                    const used = i32()[inDone >> 2];
                    if (used === 0 && collect() === 0) throw new Error("soxr made no progress");
                    else if (used > 0) collect();
                    consumed += used;
                }
                offset += chunk.length;
            }
            // Flush: no more input, take what is left in the filter.
            for (;;) {
                if (x.q(resampler, 0, 0, inDone, outBuffer, outCapacity, outDone)) throw new Error("soxr flush failed");
                if (collect() === 0) break;
            }
            return result; // shorter output stays zero-padded, longer output was cut, as in fix_length
        } finally {
            if (resampler) x.o(resampler);
            for (const pointer of [io, quality, error, inDone, outDone, inBuffer, outBuffer]) x.u(pointer);
        }
    };

    return { resample };
}
