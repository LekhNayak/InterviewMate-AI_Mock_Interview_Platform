# Emotion service

A Flask API in `models/Audio_Emotion_Analysis` that predicts emotion, gender and speaking style from a recording.

During an interview the browser sends each recorded answer here. The speaking style and emotions are averaged and shown in the feedback and in Reviews. They do not change the score. The app does not ask for the gender prediction.

## Run

Follow [Setup](setup.md#emotion-service). It listens on port 8090 and loads all three models when it starts, so startup is slow and uses a lot of memory.

## Endpoints

All are under `http://localhost:8090/api` and take `multipart/form-data` with a `file` field. If `SERVICE_TOKEN_SECRET` is set, every endpoint except `/health` needs an `Authorization: Bearer` token from `GET /api/user/service-token`.

| Method | Path | Extra fields | Returns |
|---|---|---|---|
| GET | `/health` | | Status |
| POST | `/predict` | `model_type`, `emotions_3`, `emotions_6`, `emotions_7`, `gender` | Predictions and speaking style |
| POST | `/predict/emotions` | `num_emotions`: 3, 6 or 7 (default 6) | Emotion predictions |
| POST | `/predict/gender` | | Gender prediction |
| POST | `/analyze/features` | | Sample rate, duration, MFCC and mel-spectrogram shapes |
| POST | `/visualize/polar` | `num_emotions`: 3, 6 or 7 (default 6) | Base64 PNG chart |

For `/predict`, `emotions_3` and `emotions_6` default to true, `emotions_7` and `gender` to false. `model_type` accepts only `mfccs` in practice. Any other value returns the speaking style alone, because no mel-spectrogram model is included.

Example, from `models/Audio_Emotion_Analysis`:

```bash
curl -X POST http://localhost:8090/api/predict -F "file=@answer.wav" -F "gender=true"
```

In Windows PowerShell use `curl.exe` instead of `curl`.

## Output

| Field | Values |
|---|---|
| `emotions_3` | positive, neutral, negative |
| `emotions_6` | fear, angry, neutral, happy, sad, surprise |
| `emotions_7` | fear, disgust, neutral, happy, sad, surprise, angry |
| `gender` | female, male |
| `speaking_style` | `confident` at a score of 0.5 or more, otherwise `anxious`, with energy, voiced ratio and pitch figures |

Every prediction has a `confidence` and the full set of class scores. The three-class result is calculated from the six-class model. Speaking style is a hand-written formula of loudness, share of time speaking and pitch stability. It is not a trained model.

```json
{
  "success": true,
  "message": "Prediction completed successfully",
  "file_name": "answer.wav",
  "predictions": {
    "emotions_6": { "emotion": "happy", "confidence": 0.85, "predictions": { "happy": 0.85 } },
    "speaking_style": { "label": "confident", "score": 0.62, "features": { "energy": 0.04 } }
  }
}
```

The numbers above only show the shape of a reply.

## Models

| File | Predicts |
|---|---|
| `model3.h5` | Six emotions |
| `model4.h5` | Seven emotions |
| `model_mw.h5` | Gender |

## Limits

- Formats: wav, mp3, ogg and webm, up to 9 MB. Other formats than WAV are converted with the bundled ffmpeg.
- Each request uses its own temporary folder, which is deleted afterwards.
- `test_api.py` calls port 8090 without a token, so leave `SERVICE_TOKEN_SECRET` empty when you run it.
- The accuracy of the models has not been measured in this repository.
