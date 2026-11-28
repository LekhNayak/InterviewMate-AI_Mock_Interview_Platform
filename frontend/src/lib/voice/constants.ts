// Numbers copied from the old Python emotion service. The reference copy of its code is
// models/Audio_Emotion_Analysis/reference.py, and the tests compare against it.

/** Rate the browser decodes at. Opus recordings are 48 kHz, which is also what ffmpeg gave the server. */
export const DECODE_RATE = 48000;
/** librosa.load's default rate, used for the model input. */
export const MODEL_RATE = 22050;
/** The rate the server loaded audio at for the speaking style. */
export const STYLE_RATE = 44100;

export const N_FFT = 2048;
export const HOP_LENGTH = 512;
export const N_MELS = 128;
export const N_MFCC = 40;
/** The model's input is 40 MFCCs × 91 frames, about the first 2.1 seconds of an answer. */
export const MODEL_FRAMES = 91;

export const CAT6 = ["fear", "angry", "neutral", "happy", "sad", "surprise"] as const;
export const CAT3 = ["positive", "neutral", "negative"] as const;

/** Speaking style: librosa.yin(y, fmin=50, fmax=400) and librosa.effects.split(y, top_db=30). */
export const YIN_FMIN = 50;
export const YIN_FMAX = 400;
export const SPLIT_TOP_DB = 30;

/**
 * The server called librosa.yin without the sample rate, so librosa assumed 22050 Hz although the audio
 * was 44100 Hz. Reported pitch is therefore half the real pitch, and the search covers about 100 to 800 Hz.
 * Kept on purpose so the browser gives the same scores as the server. Fixing it is a separate change.
 */
export const YIN_ASSUMED_SAMPLE_RATE = 22050;
