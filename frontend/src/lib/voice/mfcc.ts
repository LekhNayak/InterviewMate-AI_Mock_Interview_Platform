// The model input: librosa.feature.mfcc(y=y, sr=22050, n_mfcc=40) as librosa 0.10.1 computes it,
// cut or zero-padded to 91 frames like the server's get_mfccs.
//
// librosa works in float32 in several places. Those roundings are copied with Math.fround, so the values
// stay as close as possible to the server's.
import { HOP_LENGTH, MODEL_FRAMES, MODEL_RATE, N_FFT, N_MELS, N_MFCC } from "./constants";
import { fft } from "./fft";

const BINS = N_FFT / 2 + 1;
const f32 = Math.fround;

/** scipy.signal.get_window("hann", 2048, fftbins=True), computed the way scipy does. */
function hannWindow(n: number): Float64Array {
    const m = n + 1; // periodic: one point longer, then truncated
    const step = (Math.PI - -Math.PI) / (m - 1);
    const w = new Float64Array(n);
    for (let i = 0; i < n; i++) w[i] = 0 + 0.5 + 0.5 * Math.cos(i * step + -Math.PI);
    return w;
}

// librosa.core.convert, Slaney mel scale (htk=False)
const F_SP = 200.0 / 3;
const MIN_LOG_HZ = 1000.0;
const MIN_LOG_MEL = (MIN_LOG_HZ - 0.0) / F_SP;
const LOGSTEP = Math.log(6.4) / 27.0;
const hzToMel = (f: number) => (f >= MIN_LOG_HZ ? MIN_LOG_MEL + Math.log(f / MIN_LOG_HZ) / LOGSTEP : (f - 0.0) / F_SP);
const melToHz = (m: number) => (m >= MIN_LOG_MEL ? MIN_LOG_HZ * Math.exp(LOGSTEP * (m - MIN_LOG_MEL)) : 0.0 + F_SP * m);

interface MelFilter {
    start: number;
    weights: Float64Array; // float32 values
}

/** librosa.filters.mel(sr=22050, n_fft=2048, n_mels=128), with Slaney normalisation, stored sparsely. */
function melFilters(): MelFilter[] {
    const sr = MODEL_RATE;
    const val = 1.0 / (N_FFT * (1.0 / sr)); // numpy.fft.rfftfreq
    const fftFreqs = Float64Array.from({ length: BINS }, (_, k) => k * val);

    const count = N_MELS + 2; // numpy.linspace(min_mel, max_mel, n_mels + 2)
    const minMel = hzToMel(0.0);
    const maxMel = hzToMel(sr / 2);
    const step = (maxMel - minMel) / (count - 1);
    const melF = Float64Array.from({ length: count }, (_, i) => melToHz(i === count - 1 ? maxMel : i * step + minMel));

    const filters: MelFilter[] = [];
    for (let i = 0; i < N_MELS; i++) {
        const lowerDiff = melF[i + 1] - melF[i];
        const upperDiff = melF[i + 2] - melF[i + 1];
        const enorm = 2.0 / (melF[i + 2] - melF[i]);
        const row = new Float64Array(BINS);
        let first = -1;
        let last = -1;
        for (let k = 0; k < BINS; k++) {
            const lower = -(melF[i] - fftFreqs[k]) / lowerDiff;
            const upper = (melF[i + 2] - fftFreqs[k]) / upperDiff;
            const w = f32(f32(Math.max(0, Math.min(lower, upper))) * enorm);
            row[k] = w;
            if (w !== 0) {
                if (first < 0) first = k;
                last = k;
            }
        }
        filters.push(first < 0 ? { start: 0, weights: new Float64Array(0) } : { start: first, weights: row.slice(first, last + 1) });
    }
    return filters;
}

/** scipy.fftpack.dct(type=2, norm="ortho"), first 40 coefficients of 128. */
function dctMatrix(): Float64Array {
    const m = new Float64Array(N_MFCC * N_MELS);
    for (let k = 0; k < N_MFCC; k++) {
        const scale = k === 0 ? Math.sqrt(1 / N_MELS) : Math.sqrt(2 / N_MELS);
        for (let n = 0; n < N_MELS; n++) m[k * N_MELS + n] = scale * Math.cos((Math.PI * k * (2 * n + 1)) / (2 * N_MELS));
    }
    return m;
}

let tables: { window: Float64Array; filters: MelFilter[]; dct: Float64Array } | null = null;
const getTables = () => (tables ??= { window: hannWindow(N_FFT), filters: melFilters(), dct: dctMatrix() });

/**
 * MFCCs of 22050 Hz audio, as the model takes them: a 40 × 91 matrix, row by row (coefficient by frame).
 * `frames` is how many frames librosa produced before the cut or padding.
 */
export function modelInput(y: Float32Array): { matrix: Float32Array; frames: number } {
    const { window, filters, dct } = getTables();
    const frames = 1 + Math.floor(y.length / HOP_LENGTH); // centred frames, zero padding of N_FFT/2 each side
    const pad = N_FFT / 2;
    const kept = Math.min(frames, MODEL_FRAMES);
    const db = new Float64Array(kept * N_MELS);
    const re = new Float64Array(N_FFT);
    const im = new Float64Array(N_FFT);
    const power = [new Float64Array(BINS), new Float64Array(BINS)];
    let max = -Infinity;

    const windowed = (t: number, out: Float64Array) => {
        const start = t * HOP_LENGTH - pad;
        for (let n = 0; n < N_FFT; n++) {
            const i = start + n;
            out[n] = i >= 0 && i < y.length ? window[n] * y[i] : 0;
        }
    };
    // stft is stored as complex64, then |X| and |X|**2 in float32.
    const store = (bin: number, xRe: number, xIm: number, into: Float64Array) => {
        const a = f32(xRe);
        const b = f32(xIm);
        const magnitude = f32(Math.sqrt(a * a + b * b));
        into[bin] = f32(magnitude * magnitude);
    };

    // Every frame is needed: power_to_db clips at 80 dB below the loudest value of the whole answer.
    // Two real frames share one complex FFT: the first as the real part, the second as the imaginary part.
    for (let t = 0; t < frames; t++) {
        const slot = t % 2;
        if (slot === 0) {
            windowed(t, re);
            if (t + 1 < frames) windowed(t + 1, im);
            else im.fill(0);
            fft(re, im);
            for (let k = 0; k < BINS; k++) {
                const j = (N_FFT - k) % N_FFT;
                store(k, (re[k] + re[j]) / 2, (im[k] - im[j]) / 2, power[0]);
                store(k, (im[k] + im[j]) / 2, (re[j] - re[k]) / 2, power[1]);
            }
        }
        const p = power[slot];
        for (let m = 0; m < N_MELS; m++) {
            const { start: s, weights } = filters[m];
            let sum = 0;
            for (let j = 0; j < weights.length; j++) sum += weights[j] * p[s + j];
            const value = f32(10 * f32(Math.log10(f32(Math.max(f32(1e-10), f32(sum))))));
            if (value > max) max = value;
            if (t < kept) db[t * N_MELS + m] = value;
        }
    }

    const floor = f32(max - 80.0);
    const matrix = new Float32Array(N_MFCC * MODEL_FRAMES); // frames past the end stay zero, as in get_mfccs
    for (let t = 0; t < kept; t++) {
        for (let k = 0; k < N_MFCC; k++) {
            let sum = 0;
            for (let n = 0; n < N_MELS; n++) sum += dct[k * N_MELS + n] * Math.max(db[t * N_MELS + n], floor);
            matrix[k * MODEL_FRAMES + t] = sum;
        }
    }
    return { matrix, frames };
}
