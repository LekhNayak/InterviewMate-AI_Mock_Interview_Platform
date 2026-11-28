// The whole analysis of one answer, from 48 kHz mono samples to the result the server's /api/predict gave.
import { CAT3, CAT6, DECODE_RATE, MODEL_RATE, STYLE_RATE } from "./constants";
import { modelInput } from "./mfcc";
import type { Model } from "./model";
import type { Soxr } from "./soxr";
import { speakingStyle, type SpeakingStyle } from "./speaking";

export interface Prediction<C extends string> {
    emotion: C;
    confidence: number;
    predictions: Record<C, number>;
}

export interface VoiceResult {
    emotions_3: Prediction<(typeof CAT3)[number]>;
    emotions_6: Prediction<(typeof CAT6)[number]>;
    speaking_style: SpeakingStyle;
}

export interface Engine {
    soxr: Soxr;
    model: Model;
}

function prediction<C extends string>(names: readonly C[], scores: ArrayLike<number>): Prediction<C> {
    let best = 0;
    for (let i = 1; i < names.length; i++) if (scores[i] > scores[best]) best = i;
    const predictions = {} as Record<C, number>;
    names.forEach((name, i) => (predictions[name] = scores[i]));
    return { emotion: names[best], confidence: scores[best], predictions };
}

/** `pcm` is what toServerPcm returns for a recording decoded at 48 kHz. */
export function analyzePcm(pcm: Float32Array, engine: Engine): VoiceResult {
    const style = speakingStyle(engine.soxr.resample(pcm, DECODE_RATE, STYLE_RATE), STYLE_RATE);
    const p = engine.model.predict(modelInput(engine.soxr.resample(pcm, DECODE_RATE, MODEL_RATE)).matrix);
    // The three-class result, calculated from the six classes (fear, angry, neutral, happy, sad, surprise).
    // The sums are float32, as numpy computed them from the model's float32 output.
    const f = Math.fround;
    const three = [f(p[3] + f(p[5] * 0.5)), f(f(p[2] + f(p[5] * 0.5)) + f(p[4] * 0.5)), f(f(p[0] + p[1]) + f(p[4] * 0.5))];
    return { emotions_3: prediction(CAT3, three), emotions_6: prediction(CAT6, p), speaking_style: style };
}
