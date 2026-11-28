// Speaking style: compute_confidence_features and simple_confidence_score from the old server, with
// librosa 0.10.1's rms, effects.split and yin copied step by step. Runs on 44100 Hz audio.
import { HOP_LENGTH, N_FFT, SPLIT_TOP_DB, YIN_ASSUMED_SAMPLE_RATE, YIN_FMAX, YIN_FMIN } from "./constants";
import { fft, ifft } from "./fft";

export interface SpeakingFeatures {
    energy: number;
    voiced_ratio: number;
    pitch_mean: number;
    pitch_std: number;
}

export interface SpeakingStyle {
    label: "confident" | "anxious";
    score: number;
    features: SpeakingFeatures;
}

const f32 = Math.fround;
const FRAME = N_FFT; // 2048, for rms, split and yin
const HALF = FRAME / 2;

/** librosa.feature.rms(y): centred frames with zero padding, root of the mean square, in float32. */
export function rmsFrames(y: Float32Array): Float64Array {
    const frames = 1 + Math.floor(y.length / HOP_LENGTH);
    // Frame t covers samples (t − 2)·512 to (t + 2)·512, so it is the sum of four 512-sample blocks.
    const blocks = new Float64Array(frames + 4);
    for (let i = 0; i < y.length; i++) blocks[2 + Math.floor(i / HOP_LENGTH)] += f32(y[i] * y[i]);
    const out = new Float64Array(frames);
    for (let t = 0; t < frames; t++) {
        const sum = blocks[t] + blocks[t + 1] + blocks[t + 2] + blocks[t + 3];
        out[t] = f32(Math.sqrt(f32(f32(sum) / FRAME)));
    }
    return out;
}

/** Share of the recording that librosa.effects.split(y, top_db=30) finds non-silent. */
export function voicedRatio(y: Float32Array, rms: Float64Array, rate: number): number {
    // _signal_to_frame_nonsilent: amplitude_to_db(rms, ref=np.max, top_db=None) > -top_db
    let ref = 0;
    for (const v of rms) ref = Math.max(ref, v);
    const amin = 1e-5 ** 2;
    const refDb = 10 * Math.log10(Math.max(amin, ref * ref));
    const loud = Array.from(rms, (v) => 10 * Math.log10(Math.max(amin, v * v)) - refDb > -SPLIT_TOP_DB);

    // split(): edges of the non-silent runs, in samples, capped at the length of y
    const edges: number[] = [];
    if (loud[0]) edges.push(0);
    for (let i = 0; i < loud.length - 1; i++) if (loud[i] !== loud[i + 1]) edges.push(i + 1);
    if (loud[loud.length - 1]) edges.push(loud.length);
    let voiced = 0;
    for (let i = 0; i + 1 < edges.length; i += 2) {
        voiced += Math.min(edges[i + 1] * HOP_LENGTH, y.length) - Math.min(edges[i] * HOP_LENGTH, y.length);
    }
    const total = y.length / rate;
    return total > 0 ? voiced / rate / total : 0.0;
}

/**
 * librosa.yin(y, fmin=50, fmax=400) with its default sr of 22050, as the server called it on 44100 Hz audio.
 * Returns one pitch estimate per frame.
 */
export function yinPitch(y: Float32Array): Float64Array {
    const sr = YIN_ASSUMED_SAMPLE_RATE;
    const minPeriod = Math.floor(sr / YIN_FMAX);
    const maxPeriod = Math.min(Math.ceil(sr / YIN_FMIN), FRAME - HALF - 1);
    const width = maxPeriod - minPeriod + 1;
    const frames = 1 + Math.floor(y.length / HOP_LENGTH);
    const f0 = new Float64Array(frames);

    const re = new Float64Array(FRAME);
    const im = new Float64Array(FRAME);
    const qRe = new Float64Array(FRAME); // spectra of two frames, inverse-transformed together
    const qIm = new Float64Array(FRAME);
    const cumulative = new Float64Array(HALF + maxPeriod + 1);
    const energy = [new Float64Array(maxPeriod + 1), new Float64Array(maxPeriod + 1)];
    const diff = new Float64Array(maxPeriod + 1);
    const yin = new Float64Array(width);

    // Autocorrelation is irfft(rfft(x) · rfft(x[1024:0:-1]))[1024:]. The two real inputs of a frame share one
    // complex FFT, and the products of two frames share one inverse FFT: the first frame's result comes out
    // as the real part and the second's as the imaginary part. Also stores the frame's window energies.
    const prepare = (t: number, slot: 0 | 1) => {
        const start = t * HOP_LENGTH - HALF;
        for (let n = 0; n < FRAME; n++) {
            const i = start + n;
            re[n] = i >= 0 && i < y.length ? y[i] : 0;
        }
        for (let n = 0; n < HALF; n++) im[n] = re[HALF - n];
        im.fill(0, HALF);

        // Energy of each window, from a running sum in float32 as numpy's cumsum does.
        let running = 0;
        for (let n = 0; n < cumulative.length; n++) {
            running = f32(running + f32(re[n] * re[n]));
            cumulative[n] = running;
        }
        const e = energy[slot];
        for (let tau = 0; tau <= maxPeriod; tau++) {
            const v = f32(cumulative[HALF + tau] - cumulative[tau]);
            e[tau] = Math.abs(v) < 1e-6 ? 0 : v;
        }

        fft(re, im);
        for (let k = 0; k <= FRAME / 2; k++) {
            const j = (FRAME - k) % FRAME;
            const aRe = (re[k] + re[j]) / 2;
            const aIm = (im[k] - im[j]) / 2;
            const bRe = (im[k] + im[j]) / 2;
            const bIm = (re[j] - re[k]) / 2;
            const pRe = aRe * bRe - aIm * bIm;
            const pIm = aRe * bIm + aIm * bRe;
            if (slot === 0) {
                qRe[k] = pRe;
                qIm[k] = pIm;
                if (j !== k) {
                    qRe[j] = pRe;
                    qIm[j] = -pIm;
                }
            } else {
                // add i·P: P[k] = (pRe, pIm) and P[j] = (pRe, −pIm)
                qRe[k] -= pIm;
                qIm[k] += pRe;
                if (j !== k) {
                    qRe[j] += pIm;
                    qIm[j] += pRe;
                }
            }
        }
    };

    const finish = (t: number, slot: 0 | 1) => {
        const acfs = slot === 0 ? qRe : qIm;
        const e = energy[slot];
        // Difference function and cumulative mean normalisation.
        for (let tau = 0; tau <= maxPeriod; tau++) {
            const acfValue = acfs[HALF + tau];
            const acf = Math.abs(acfValue) < 1e-6 ? 0 : acfValue;
            diff[tau] = f32(e[0] + e[tau]) - 2 * acf;
        }
        let cumsum = 0;
        for (let tau = 1; tau <= maxPeriod; tau++) {
            cumsum += diff[tau];
            if (tau >= minPeriod) {
                const mean = cumsum / tau;
                yin[tau - minPeriod] = diff[tau] / (mean + 2.2250738585072014e-308);
            }
        }

        // First trough below 0.1, or the global minimum, refined by parabolic interpolation.
        let period = -1;
        let globalMin = 0;
        for (let i = 0; i < width; i++) {
            if (yin[i] < yin[globalMin]) globalMin = i;
            if (period < 0 && yin[i] < 0.1) {
                const trough = i === 0 ? yin[0] < yin[1] : i === width - 1 ? yin[i] < yin[i - 1] : yin[i] < yin[i - 1] && yin[i] <= yin[i + 1];
                if (trough) period = i;
            }
        }
        if (period < 0) period = globalMin;
        let shift = 0;
        if (period > 0 && period < width - 1) {
            const a = yin[period + 1] + yin[period - 1] - 2 * yin[period];
            const b = (yin[period + 1] - yin[period - 1]) / 2;
            shift = Math.abs(b) >= Math.abs(a) ? 0 : -b / a;
        }
        f0[t] = sr / (minPeriod + period + shift);
    };

    for (let t = 0; t < frames; t += 2) {
        const pair = t + 1 < frames;
        prepare(t, 0);
        if (pair) prepare(t + 1, 1);
        ifft(qRe, qIm);
        finish(t, 0);
        if (pair) finish(t + 1, 1);
    }
    return f0;
}

export function speakingFeatures(y: Float32Array, rate: number): SpeakingFeatures {
    const rms = rmsFrames(y);
    let sum = 0;
    for (const v of rms) sum += v;
    const energy = f32(sum / rms.length);

    const pitches = Array.from(yinPitch(y)).filter((p) => p > 0);
    let pitchMean = 0;
    let pitchStd = 0;
    if (pitches.length > 0) {
        pitchMean = pitches.reduce((a, b) => a + b, 0) / pitches.length;
        pitchStd = Math.sqrt(pitches.reduce((a, p) => a + (p - pitchMean) ** 2, 0) / pitches.length);
    }
    return { energy, voiced_ratio: voicedRatio(y, rms, rate), pitch_mean: pitchMean, pitch_std: pitchStd };
}

/** The server's hand-written score: 0 means more anxious, 1 more confident. */
export function speakingScore(f: SpeakingFeatures): number {
    const energyTerm = Math.min(f.energy / 0.05, 1.0);
    const voicedTerm = Math.min(f.voiced_ratio / 0.7, 1.0);
    const stabilityTerm = 1.0 - Math.min(f.pitch_std / 60.0, 1.0);
    return 0.4 * energyTerm + 0.4 * voicedTerm + 0.2 * stabilityTerm;
}

export function speakingStyle(y: Float32Array, rate: number): SpeakingStyle {
    const features = speakingFeatures(y, rate);
    const score = speakingScore(features);
    return { label: score >= 0.5 ? "confident" : "anxious", score, features };
}
