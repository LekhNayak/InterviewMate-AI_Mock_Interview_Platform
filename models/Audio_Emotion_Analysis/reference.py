"""The voice analysis as the old Flask emotion service did it, kept as the reference for the browser version.

The functions below are copied unchanged from the service's main.py (removed on 2026-11-28), including
its known quirks, so the tests in frontend/src/lib/voice compare against exactly what users used to get:

- the six- and three-emotion results use only the first 91 MFCC frames (about 2.1 s) of an answer;
- librosa.yin is called without the sample rate, so it assumes 22050 Hz on 44100 Hz audio and
  reports half the real pitch.

analyze_file() returns what POST /api/predict returned under "predictions" for the fields the
interview page sent (model_type=mfccs, emotions_3, emotions_6).
"""
import os
import shutil
import subprocess as _sp
import tempfile

import imageio_ffmpeg
import librosa
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(HERE, "model3.h5")

CAT6 = ['fear', 'angry', 'neutral', 'happy', 'sad', 'surprise']
CAT3 = ["positive", "neutral", "negative"]

_FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
_model = None


def model():
    """The six-emotion Keras model, loaded on first use (TensorFlow is slow to import)."""
    global _model
    if _model is None:
        from tensorflow.keras.models import load_model
        _model = load_model(MODEL_PATH)
    return _model


# ---------- copied unchanged from main.py ----------

def get_mfccs(audio_path: str, limit: int):
    """Extract MFCC features from audio file"""
    y, sr = librosa.load(audio_path)
    a = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=40)
    if a.shape[1] > limit:
        mfccs = a[:, :limit]
    elif a.shape[1] < limit:
        mfccs = np.zeros((a.shape[0], limit))
        mfccs[:, :a.shape[1]] = a
    else:
        mfccs = a
    return mfccs


def compute_confidence_features(y, sr):
    """
    Compute basic prosodic features related to speaking confidence:
    - energy (RMS)
    - voiced_ratio (how much of the time you're speaking)
    - pitch_mean and pitch_std (average pitch and its stability)
    """
    # Energy / loudness
    rms = librosa.feature.rms(y=y)[0]
    energy = float(np.mean(rms))

    # Voice activity (how much of the time you're actually speaking)
    try:
        intervals = librosa.effects.split(y, top_db=30)
        voiced_dur = sum((end - start) for start, end in intervals) / sr
        total_dur = len(y) / sr
        voiced_ratio = voiced_dur / total_dur if total_dur > 0 else 0.0
    except Exception:
        voiced_ratio = 0.0

    # Pitch (fundamental frequency) and stability
    try:
        f0 = librosa.yin(y, fmin=50, fmax=400)
        f0 = f0[f0 > 0]  # keep only valid pitches
        pitch_mean = float(np.mean(f0)) if len(f0) > 0 else 0.0
        pitch_std = float(np.std(f0)) if len(f0) > 0 else 0.0
    except Exception:
        pitch_mean, pitch_std = 0.0, 0.0

    return {
        "energy": energy,
        "voiced_ratio": voiced_ratio,
        "pitch_mean": pitch_mean,
        "pitch_std": pitch_std,
    }


def simple_confidence_score(features):
    """
    Rough heuristic score:
    0.0 = low confidence / more anxious
    1.0 = high confidence
    """
    energy = features["energy"]
    voiced_ratio = features["voiced_ratio"]
    pitch_std = features["pitch_std"]

    # Rough normalization / scaling – tweak as you like
    energy_term = min(energy / 0.05, 1.0)              # louder → more confident
    voiced_term = min(voiced_ratio / 0.7, 1.0)         # speaking most of the time
    stability_term = 1.0 - min(pitch_std / 60.0, 1.0)  # more stable pitch → more confident

    score = 0.4 * energy_term + 0.4 * voiced_term + 0.2 * stability_term
    return float(score)  # 0–1


def convert_to_wav(path):
    if path.lower().endswith(".wav"):
        return path

    wav_path = os.path.splitext(path)[0] + ".wav"
    try:
        result = _sp.run(
            [_FFMPEG, "-y", "-i", path, wav_path],
            capture_output=True,
        )
        if result.returncode != 0:
            raise Exception(result.stderr.decode(errors="replace"))
        return wav_path
    except Exception as e:
        raise Exception(f"FFmpeg conversion failed: {str(e)}")

# ----------------------------------------------------


def three_emotions(pred):
    """The three-class result, calculated from the six-class prediction as main.py did."""
    pos = pred[3] + pred[5] * .5
    neu = pred[2] + pred[5] * .5 + pred[4] * .5
    neg = pred[0] + pred[1] + pred[4] * .5
    return np.array([pos, neu, neg])


def result_from_mfccs(mfccs, features):
    """The "predictions" object of /api/predict, from the model input and the speaking features."""
    pred = model().predict(mfccs.reshape(1, *mfccs.shape), verbose=0)[0]
    data3 = three_emotions(pred)
    score = simple_confidence_score(features)
    return {
        "emotions_3": {
            "emotion": CAT3[data3.argmax()],
            "confidence": float(data3.max()),
            "predictions": {CAT3[i]: float(data3[i]) for i in range(len(CAT3))},
        },
        "emotions_6": {
            "emotion": CAT6[pred.argmax()],
            "confidence": float(pred.max()),
            "predictions": {CAT6[i]: float(pred[i]) for i in range(len(CAT6))},
        },
        "speaking_style": {
            "label": "confident" if score >= 0.5 else "anxious",
            "score": score,
            "features": features,
        },
    }


def analyze_wav(wav_path):
    """The service's steps after its ffmpeg conversion. Raises where the service answered 400 or 500."""
    wav, sr = librosa.load(wav_path, sr=44100)
    features = compute_confidence_features(wav, sr)
    mfccs = get_mfccs(wav_path, model().input_shape[-1])
    return result_from_mfccs(mfccs, features)


def analyze_file(path):
    """The whole service: an uploaded recording (webm, ogg, mp3 or wav) in, the predictions out."""
    with tempfile.TemporaryDirectory() as folder:
        name = os.path.basename(path) or "upload.wav"
        copy = os.path.join(folder, name)
        shutil.copy(path, copy)
        return analyze_wav(convert_to_wav(copy))
