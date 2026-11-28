import { DECODE_RATE } from "./constants";

/**
 * Decodes a recording at 48 kHz and returns a copy of each channel, ready to transfer to the worker.
 * Runs on the main thread, because Web Audio is not available in workers. Opus, which Chrome and Firefox
 * record, is 48 kHz already, so the browser does not resample it, just as ffmpeg did not on the server.
 */
export async function decodeRecording(blob: Blob): Promise<Float32Array[]> {
    const audio = await new OfflineAudioContext(1, 1, DECODE_RATE).decodeAudioData(await blob.arrayBuffer());
    return Array.from({ length: audio.numberOfChannels }, (_, c) => audio.getChannelData(c).slice());
}
