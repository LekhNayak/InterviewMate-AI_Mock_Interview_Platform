// The six-emotion Keras model (model3.h5), run with its own weights in plain TypeScript.
// Conv1D(256, 5, same) → ReLU → MaxPool(8) → Conv1D(128, 5, same) → ReLU → MaxPool(4) → Flatten
// → Dense(64) → Dense(6) → softmax. Dropout does nothing at prediction time, so it is left out.
import { MODEL_FRAMES, N_MFCC } from "./constants";

export interface ModelLayout {
    values: number;
    tensors: Record<string, { shape: number[]; offset: number }>;
}

export interface Model {
    /** `input` is the 40 × 91 MFCC matrix, row by row (40 steps of 91 channels). Returns the six probabilities. */
    predict(input: Float32Array): Float32Array;
}

const STEPS = N_MFCC;
const CHANNELS = MODEL_FRAMES;

/** Conv1D with padding "same" and stride 1, then ReLU. Keras kernel layout: [k][in][out]. */
function convRelu(x: Float32Array, steps: number, inC: number, kernel: Float32Array, bias: Float32Array, outC: number, k: number) {
    const y = new Float32Array(steps * outC);
    const left = (k - 1) >> 1;
    for (let t = 0; t < steps; t++) {
        for (let o = 0; o < outC; o++) {
            let sum = bias[o];
            for (let j = 0; j < k; j++) {
                const s = t + j - left;
                if (s < 0 || s >= steps) continue;
                const xo = s * inC;
                const wo = j * inC * outC + o;
                for (let c = 0; c < inC; c++) sum += x[xo + c] * kernel[wo + c * outC];
            }
            y[t * outC + o] = sum > 0 ? sum : 0;
        }
    }
    return y;
}

/** MaxPooling1D with padding "valid": trailing steps that do not fill a window are dropped. */
function maxPool(x: Float32Array, steps: number, channels: number, size: number) {
    const outSteps = Math.floor(steps / size);
    const y = new Float32Array(outSteps * channels);
    for (let t = 0; t < outSteps; t++) {
        for (let c = 0; c < channels; c++) {
            let m = -Infinity;
            for (let p = 0; p < size; p++) m = Math.max(m, x[(t * size + p) * channels + c]);
            y[t * channels + c] = m;
        }
    }
    return { y, steps: outSteps };
}

function dense(x: Float32Array, kernel: Float32Array, bias: Float32Array, out: number) {
    const y = new Float32Array(out);
    for (let o = 0; o < out; o++) {
        let sum = bias[o];
        for (let i = 0; i < x.length; i++) sum += x[i] * kernel[i * out + o];
        y[o] = sum;
    }
    return y;
}

function softmax(x: Float32Array) {
    const max = Math.max(...x);
    const e = Array.from(x, (v) => Math.exp(v - max));
    const total = e.reduce((a, b) => a + b, 0);
    return Float32Array.from(e, (v) => v / total);
}

export function createModel(layout: ModelLayout, weights: ArrayBuffer): Model {
    const all = new Float32Array(weights);
    if (all.length !== layout.values) throw new Error(`model weights have ${all.length} values, expected ${layout.values}`);
    const tensor = (name: string, shape: number[]) => {
        const info = layout.tensors[name];
        if (!info || info.shape.join() !== shape.join()) throw new Error(`model tensor ${name} is missing or has the wrong shape`);
        return all.subarray(info.offset, info.offset + shape.reduce((a, b) => a * b, 1));
    };
    const conv1 = { k: tensor("conv1_kernel", [5, CHANNELS, 256]), b: tensor("conv1_bias", [256]) };
    const conv2 = { k: tensor("conv2_kernel", [5, 256, 128]), b: tensor("conv2_bias", [128]) };
    const dense1 = { k: tensor("dense1_kernel", [128, 64]), b: tensor("dense1_bias", [64]) };
    const dense2 = { k: tensor("dense2_kernel", [64, 6]), b: tensor("dense2_bias", [6]) };

    return {
        predict(input) {
            if (input.length !== STEPS * CHANNELS) throw new Error(`model input has ${input.length} values, expected ${STEPS * CHANNELS}`);
            const a = convRelu(input, STEPS, CHANNELS, conv1.k, conv1.b, 256, 5);
            const p1 = maxPool(a, STEPS, 256, 8);
            const b = convRelu(p1.y, p1.steps, 256, conv2.k, conv2.b, 128, 5);
            const p2 = maxPool(b, p1.steps, 128, 4);
            if (p2.y.length !== 128) throw new Error("unexpected flatten size");
            return softmax(dense(dense(p2.y, dense1.k, dense1.b, 64), dense2.k, dense2.b, 6));
        },
    };
}
