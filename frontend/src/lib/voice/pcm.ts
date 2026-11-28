// The server converted each upload to a 16-bit WAV with ffmpeg, then librosa read it and averaged the
// channels to mono. Doing the same here keeps quiet passages, where the rounding matters, identical.

/** Round half to even, like C's lrintf in the default rounding mode. */
function roundHalfEven(x: number): number {
    const r = Math.round(x);
    return r - x === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

/** ffmpeg's float to 16-bit conversion, read back as librosa reads a 16-bit WAV (divided by 32768). */
export function to16Bit(channel: Float32Array): Float32Array {
    const out = new Float32Array(channel.length);
    for (let i = 0; i < channel.length; i++) {
        out[i] = Math.max(-32768, Math.min(32767, roundHalfEven(channel[i] * 32768))) / 32768;
    }
    return out;
}

/** librosa.to_mono: the mean of the channels, accumulated in float32. */
export function toMono(channels: Float32Array[]): Float32Array {
    if (channels.length === 0) return new Float32Array(0);
    if (channels.length === 1) return channels[0];
    const n = channels[0].length;
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
        let sum = 0;
        for (const c of channels) sum = Math.fround(sum + c[i]);
        out[i] = sum / channels.length;
    }
    return out;
}

/** Decoded channels in, the mono 16-bit samples the server would have analysed out. */
export const toServerPcm = (channels: Float32Array[]) => toMono(channels.map(to16Bit));
