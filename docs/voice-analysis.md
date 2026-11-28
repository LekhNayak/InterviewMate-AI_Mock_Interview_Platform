# Voice analysis

During a mock interview, each recorded answer gets a voice reading: an emotion out of six, an emotion out of three, and a speaking style. The readings are averaged and shown in the feedback and in Reviews. They do not change the score.

The analysis runs in the browser, in a Web Worker, so it needs no server and the recording is not sent anywhere for it. It replaced a Flask and TensorFlow service, and gives the same results: the same trained model, the same audio steps, and tests that compare it with the old service's code.

## How it works

```mermaid
flowchart LR
    rec["Recorded answer<br/>WebM/Opus"] --> dec["Decode at 48 kHz<br/>main thread"]
    dec --> pcm["Round to 16-bit,<br/>average to mono"]
    pcm --> s44["soxr to 44.1 kHz"] --> style["Speaking style:<br/>loudness, voiced share, pitch"]
    pcm --> s22["soxr to 22.05 kHz"] --> mfcc["40 MFCCs,<br/>first 91 frames"] --> model["model3.h5 weights"] --> emo["6 emotions,<br/>3 emotions"]
```

Everything after decoding runs in the worker. The code is in [frontend/src/lib/voice](../frontend/src/lib/voice):

| File | Step |
|---|---|
| `decode.ts` | Decodes the recording at 48 kHz with Web Audio. Opus, which Chrome and Firefox record, is 48 kHz already, as it was for ffmpeg on the server. |
| `pcm.ts` | Rounds to 16-bit and averages the channels, as the server's ffmpeg conversion and librosa did. Quiet passages depend on this. |
| `soxr.ts` | Resamples with libsoxr compiled to WebAssembly, the resampler librosa used (`soxr_hq`). |
| `mfcc.ts` | librosa's MFCCs: 2048-point frames, hop 512, 128 mel bands, 40 coefficients, cut or padded to 91 frames |
| `model.ts` | The six-emotion model with the weights of `model3.h5`: two convolution layers and two dense layers |
| `speaking.ts` | The speaking style formula: loudness (`rms`), share of time speaking (`effects.split`) and pitch stability (`yin`) |
| `analyze.ts` | Puts the steps together and builds the result |
| `voice.worker.ts`, `index.ts` | The worker and the functions the interview page calls |

The model weights (1.16 MB) and the resampler (99 KB) are downloaded when an interview starts.

## Output

| Field | Values |
|---|---|
| `emotions_6` | fear, angry, neutral, happy, sad, surprise |
| `emotions_3` | positive, neutral, negative, calculated from the six: positive = happy + ½ surprise, neutral = neutral + ½ surprise + ½ sad, negative = fear + angry + ½ sad |
| `speaking_style` | `confident` at a score of 0.5 or more, otherwise `anxious` |

Each emotion has a `confidence` and the scores of every class. The speaking score is `0.4 × min(energy / 0.05, 1) + 0.4 × min(voiced share / 0.7, 1) + 0.2 × (1 − min(pitch spread / 60, 1))`. It is a hand-written formula, not a trained model.

## How it is tested

The old service's analysis is kept, unchanged, as [models/Audio_Emotion_Analysis/reference.py](../models/Audio_Emotion_Analysis/reference.py). It was checked against the running Flask service before that was removed, and gave identical results.

`npm test -w frontend` compares each step with it on synthetic test signals (tones, gliding voiced sounds, noise, silence, very short clips, a quiet start with a loud end). The signals are generated from the same formula in Python and TypeScript, with a checksum, so no audio is stored.

| Step | Bar | Largest difference measured |
|---|---|---|
| soxr | Every sample within 1e-5 of python-soxr, same length | 3e-7 |
| Model | Each probability within 1e-5 of TensorFlow | 3.3e-6 |
| MFCCs | Within 0.01 of librosa, same number of frames | 6e-5 |
| Speaking style | Energy within 0.1%, voiced share within one frame, pitch within 1%, score within 0.005 | Energy 0.00001%, the others below 1e-11 |
| Whole analysis | Same top emotions and label, probabilities within 0.001, score within 0.005 | Probability 4.7e-6, score 9e-8, same top emotions and labels on all 8 signals |

These were measured on 2026-11-28 with librosa 0.10.1, python-soxr 1.1.0 and TensorFlow 2.20.

To change the expected values, edit `reference.py` or the signals and run `make_fixtures.py`; see the [folder's README](../models/Audio_Emotion_Analysis/README.md).

[browser_check.py](../models/Audio_Emotion_Analysis/browser_check.py) checks the real thing: headless Chrome records speech files through a fake microphone on a developer page (`frontend/voice-check/`), runs the browser analysis, and the script compares the result with `reference.py` on the same recording. It also reports how long the analysis took and the longest pause of the page.

On 2026-11-28, in headless Chrome 155 on Windows, with seven synthetic speech recordings (Windows text-to-speech) from 3 seconds to 3.5 minutes:

- The top emotions and the speaking labels matched the old service on every recording. The largest probability difference was 0.000013, and the speaking scores were identical.
- The analysis took 0.4 to 0.6 s for answers of up to 15 s, 1.1 s for 52 s, and 2.6 s for 3.5 minutes, on a laptop that was busy with other work at the same time. The page never paused for 50 ms or more.
- Not yet checked: real voices, Firefox and Safari.

## Known limits

These are copied from the old service on purpose, so that readings stay comparable. Changing them is a separate change.

- **Only the start of each answer is read for emotions.** The model takes 91 frames, about the first 2.1 seconds. The speaking style uses the whole answer.
- **The pitch value is half the real pitch.** The server called `librosa.yin` without the sample rate, so it assumed 22050 Hz on 44100 Hz audio, and its search covers about 100 to 800 Hz instead of 50 to 400 Hz. Only the pitch spread enters the score, and it reads too favourably. The constant is `YIN_ASSUMED_SAMPLE_RATE` in `constants.ts`.
- **Silence counts as speech.** On a silent recording the voiced share is 100%, because `effects.split` compares each frame with the loudest one.
- **The accuracy of the model has not been measured** in this repository. Matching the old service does not show that its emotions are right.
- **Safari** may record MP4/AAC at 44.1 kHz. The browser then resamples it to 48 kHz while decoding, which the server did not do, so its readings can differ slightly. This was not tested.

## License

libsoxr is licensed under the LGPL 2.1 or later. The WebAssembly file comes from the npm package `wasm-audio-resampler` 2.0.0, unmodified, and is loaded as a separate file. The notice, the license and where to get the source are in [frontend/public/licenses/soxr](../frontend/public/licenses/soxr), which is deployed with the site.
