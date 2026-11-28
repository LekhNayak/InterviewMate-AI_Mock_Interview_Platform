"""Writes the expected values that frontend/src/lib/voice is tested against.

Every expected value comes from reference.py, the old emotion service's own code. The test signals are
generated from a formula, here and in frontend/src/lib/voice/__tests__/signals.ts, so no audio is stored.
Each signal has a checksum, so the tests fail loudly if the two generators ever disagree.

Run:  .venv/Scripts/python make_fixtures.py  (or .venv/bin/python on macOS and Linux)
"""
import json
import math
import os
import tempfile

import librosa
import numpy as np
import soundfile as sf

import reference

OUT = os.path.join(reference.HERE, "..", "..", "frontend", "src", "lib", "voice", "__tests__", "fixtures")
TWO_PI = 2 * math.pi

# name: (seconds, or a fixed number of samples as an int, seed of the noise generator)
SIGNALS = {
    "voiced": (3.2, 11),
    "quiet": (3.0, 12),
    "tone": (2.5, 13),
    "late_loud": (3.5, 14),
    "burst": (2.6, 15),
    "silence": (2.0, 16),
    "short": (1000, 17),
    "half_second": (0.45, 18),
}
MFCC_SIGNALS = ["voiced", "quiet", "tone", "late_loud", "burst", "silence", "short"]


def lcg(seed):
    """Same 32-bit generator as signals.ts, so both sides produce identical noise."""
    state = seed & 0xFFFFFFFF
    while True:
        state = (1664525 * state + 1013904223) & 0xFFFFFFFF
        yield state / 4294967296 * 2 - 1


def voiced(t):
    syllable = math.sin(TWO_PI * 2.2 * t)
    envelope = syllable if syllable > 0 else 0.0
    phase = TWO_PI * (150 * t + 12 * math.sin(TWO_PI * 0.9 * t))
    return envelope * (math.sin(phase) + 0.5 * math.sin(2 * phase) + 0.25 * math.sin(3 * phase))


def value(name, t, noise):
    if name in ("voiced", "short", "half_second"):
        return 0.35 * voiced(t) + 0.02 * noise
    if name == "quiet":
        return 0.004 * noise
    if name == "tone":
        return 0.3 * math.sin(TWO_PI * 220 * t)
    if name == "late_loud":
        return 0.003 * noise if t < 2.4 else 0.5 * voiced(t) + 0.02 * noise
    if name == "burst":
        return 0.4 * math.sin(TWO_PI * 300 * t) if t < 0.35 else 0.0
    if name == "silence":
        return 0.0
    raise KeyError(name)


def length(name, rate):
    size, _ = SIGNALS[name]
    return size if isinstance(size, int) else math.floor(size * rate)


def wave(name, rate):
    noise = lcg(SIGNALS[name][1])
    return [value(name, i / rate, next(noise)) for i in range(length(name, rate))]


def float32_signal(name, rate):
    return np.array(wave(name, rate), dtype=np.float32)


def int16_signal(name, rate):
    return np.array([max(-32768, min(32767, math.floor(v * 32768 + 0.5))) for v in wave(name, rate)], dtype=np.int16)


def checksum(array):
    """Order-independent and exact: the sum of the raw bits, modulo 2**32."""
    bits = array.view(np.uint32 if array.dtype == np.float32 else np.uint16).astype(np.uint64)
    return int(bits.sum() % 2**32)


def f32(x):
    """A float32 value written with enough digits to read back exactly."""
    return float(f"{float(x):.9g}")


def fit(a, limit):
    """The cut or zero-pad of reference.get_mfccs."""
    if a.shape[1] > limit:
        return a[:, :limit]
    out = np.zeros((a.shape[0], limit))
    out[:, : a.shape[1]] = a
    return out


def rounded(result):
    if isinstance(result, dict):
        return {k: rounded(v) for k, v in result.items()}
    if isinstance(result, float):
        return float(f"{result:.12g}")
    return result


def main():
    os.makedirs(OUT, exist_ok=True)
    limit = reference.model().input_shape[-1]
    fixtures = {"signals": {}, "mfcc": {}, "speaking": {}, "model": {}, "pipeline": {}, "soxr": {}}

    def note(name, rate, array):
        fixtures["signals"][f"{name}@{rate}"] = {"length": int(array.size), "checksum": checksum(array)}

    # Model input, straight from librosa at 22050 Hz.
    for name in MFCC_SIGNALS:
        y = float32_signal(name, 22050)
        note(name, 22050, y)
        a = librosa.feature.mfcc(y=y, sr=22050, n_mfcc=40)
        m = fit(a, limit)
        fixtures["mfcc"][name] = {"frames": int(a.shape[1]), "matrix": [f32(v) for v in m.astype(np.float32).ravel()]}

    # Speaking style at 44100 Hz, with the server's own function.
    for name in SIGNALS:
        y = float32_signal(name, 44100)
        note(name, 44100, y)
        features = reference.compute_confidence_features(y, 44100)
        fixtures["speaking"][name] = {"features": rounded(features), "score": rounded(reference.simple_confidence_score(features))}

    # The model alone: the MFCC matrices above, plus two random ones.
    for name in MFCC_SIGNALS:
        m = np.array(fixtures["mfcc"][name]["matrix"], dtype=np.float32).reshape(40, limit)
        fixtures["model"][name] = [f32(p) for p in reference.model().predict(m[None], verbose=0)[0]]
    for seed in (7, 8):
        noise = lcg(seed)
        m = np.array([next(noise) * 300 for _ in range(40 * limit)], dtype=np.float32).reshape(40, limit)
        fixtures["model"][f"random{seed}"] = [f32(p) for p in reference.model().predict(m[None], verbose=0)[0]]

    # The whole service on 16-bit 48 kHz audio, which is what the browser has after decoding and rounding.
    with tempfile.TemporaryDirectory() as folder:
        for name in SIGNALS:
            pcm = int16_signal(name, 48000)
            note(name, 48000, pcm)
            path = os.path.join(folder, f"{name}.wav")
            sf.write(path, pcm, 48000, subtype="PCM_16")
            try:
                fixtures["pipeline"][name] = rounded(reference.analyze_wav(path))
            except Exception as e:  # the service answered 400 or 500
                fixtures["pipeline"][name] = {"error": str(e)}

    # The resampler gate: python-soxr, called as librosa.load calls it, on two 16-bit inputs.
    blobs, offset = [], 0
    for name, size in (("voiced", 24000), ("short", None)):
        y = int16_signal(name, 48000)[:size].astype(np.float32) / 32768
        for rate in (22050, 44100):
            out = librosa.resample(y, orig_sr=48000, target_sr=rate, res_type="soxr_hq").astype("<f4")
            fixtures["soxr"][f"{name}@{rate}"] = {"input": int(y.size), "offset": offset, "length": int(out.size)}
            blobs.append(out.tobytes())
            offset += out.size
    with open(os.path.join(OUT, "soxr.f32"), "wb") as f:
        f.write(b"".join(blobs))

    with open(os.path.join(OUT, "expected.json"), "w", encoding="utf-8") as f:
        json.dump(fixtures, f, separators=(",", ":"))
        f.write("\n")
    print("Wrote", os.path.normpath(OUT))


if __name__ == "__main__":
    main()
