# Voice analysis in the browser: design

Status: approved by the owner on 2026-11-28 and built the same day. Notes on what changed while building are under "As built" at the end. The current guide is [docs/voice-analysis.md](../../voice-analysis.md).

## Intent

The owner asked whether the audio emotion analysis could run on Vercel. Today it is a Flask and TensorFlow service that needs a separate server (Docker, Caddy, an Oracle machine, or Render). TensorFlow alone is about 1.3 GB installed, far over what a Vercel function can hold, so the service cannot simply be moved there.

The decision, made by the owner: run the analysis **in the browser**, using the same trained model and the same steps as the server, and get the same results. The interview then needs no emotion server, and the recorded audio no longer travels to one for this analysis (it still goes to the interview service for transcription).

## Goals

- Compute the voice reading for each recorded answer in the browser: `emotions_3`, `emotions_6` and `speaking_style`.
- Use the existing trained weights of `model3.h5`. No retraining, no replacement model.
- Return the same result shape as today (`EmotionResult` in `frontend/src/types/index.ts`), so `summarizeEmotions`, the feedback card, the saved interview and Reviews keep working unchanged.
- Match the server's results closely enough that no one could tell which produced them (bars under Testing).
- The interview never stalls or fails because of the voice analysis.

## Non-goals

- Gender (`model_mw.h5`), seven emotions (`model4.h5`), the polar chart and the feature endpoints. The interview page does not use them.
- Fixing the pitch calculation. It is copied as it is now and fixed afterwards, as its own change.
- Analyzing more than the first part of each answer (see Known limits).
- Measuring or improving the accuracy of the model.
- Removing the Python service, its Dockerfile, `render.yaml`, `deploy/` or the server. They stay until the owner decides. (The owner then decided to remove them; see "As built".)

## Anti-goals (a failure even if it technically works)

- Results that differ from the server's without anyone noticing.
- A frozen page or a slower interview.
- A change to the interview score. The voice reading must stay informational.
- Any claim that matching the Python output proves the emotions are correct. The repo has no accuracy measurement.

## Constraints

- The frontend is a static Vite and React app on Vercel. TypeScript is strict, with `erasableSyntaxOnly` and `verbatimModuleSyntax`, so no enums or parameter properties.
- The repo has no tests and no test runner. One has to be added.
- `AudioContext` and `decodeAudioData` do not exist inside a Web Worker, so decoding happens on the main thread.
- Answers are recorded with `MediaRecorder`. Chrome produced WebM/Opus at 48 kHz, mono, in the test. Firefox also records Opus. Safari may record MP4/AAC.
- The feedback step waits at most 8 seconds (`EMOTION_WAIT_MS`) for pending voice results. Answers are at most about 3 minutes, because the interview service accepts at most 4.5 MB per request.
- Real voice recordings are personal data. An earlier commit removed personal data from the repo, so recordings are never committed.

## Approaches

| | Idea | Trade-off |
|---|---|---|
| A | Replace TensorFlow with NumPy in a Vercel Python function | Keeps a server-side step. Installed size measured about 430 to 500 MB on Windows against a 500 MB limit, so it is a tight fit that only a real Vercel build can confirm. |
| B | Keep TensorFlow and use the Large Functions beta (up to 5 GB) | Least code, but a beta feature, with slow first requests after idle periods that could miss the 8-second wait. |
| **C** | **Run it in the browser** | Most work, because the audio processing is rewritten. No size limit, no server, no cold starts. The risk is silent differences, which the tests are built to catch. |

**Chosen by the owner: C.**

### Language for the browser code

The owner asked whether Rust (compiled to WebAssembly) would be better than TypeScript. It was checked, and **TypeScript was chosen** (my call, which the owner left to me):

- **Results do not depend on the language.** They depend on copying librosa's steps and the server's resampler exactly. The browser test showed that the resampler, soxr, is the step that decides how close the results are (see Findings). soxr is a C library. There is no Rust port, only Rust bindings to the C code, and those do not build easily for the browser target. In both languages, soxr is brought in as a separate WebAssembly file.
- **JavaScript is fast enough.** Measured in Node 24, which uses Chrome's engine: the model takes about 10 ms, the model input about 5 ms, and the pitch step about 0.8 s for a 60-second answer and 2.4 s for 3 minutes, before the usual halving from a real-input FFT. It runs in a worker while the interview goes on. Rust might save about a second on the longest answers.
- **Rust has real costs here.** It is not installed on the development machine, and Vercel's build image does not include it, so every build would install it or the compiled file would be committed. The frontend would gain a second language and a JavaScript-to-WebAssembly boundary to maintain.

### How to run the model (my call)

- **Plain TypeScript (chosen).** Two convolution layers and two dense layers, about 289,000 weights. A few small functions run it, with nothing to download except the 1.16 MB of weights.
- TensorFlow.js or ONNX Runtime Web. A large dependency and a conversion step for a model this small, with no benefit.

## Findings from the browser test

A throwaway test (outside the repo) recorded five clips with headless Chrome 155 through a fake microphone, using the same `MediaRecorder` setup as the interview page. The clips were synthetic speech from Windows text-to-speech, 2.4 to 51 seconds long. The server's own Python functions were then run on each recording and compared with ways the browser could prepare the audio.

- Chrome's decoding at 48 kHz matches ffmpeg's: 65 to 75 dB signal-to-noise ratio, no time shift. Decoding a 51-second answer took about 0.1 s.
- The server writes ffmpeg's output as a 16-bit WAV before librosa reads it. Copying that rounding matters: without it, quiet frames give very different MFCC values.

| Browser preparation, then the server's own feature and model code | Largest probability difference | Same top emotion | Speaking score |
|---|---|---|---|
| Decode at 48 kHz, round to 16-bit, soxr HQ (the server's steps) | 0.00002 | 5 of 5 | identical |
| The same without the 16-bit rounding | 0.0099 | 5 of 5 | identical |
| Decode at 48 kHz, a simple polyphase resampler | 0.022 | 5 of 5 | identical |
| Let Chrome resample to 22050 Hz | 0.052 | 5 of 5 | identical |

In the first row, soxr ran in Python on the browser-decoded samples. **Running soxr inside the browser could not be tested:** the tool's safety check blocked loading the downloaded package into the browser. That check is therefore the first task of the build (see Resampler).

The clips were synthetic voices and only Chrome was tested. Real voices, noisy microphones, Firefox and Safari still need testing.

## Design

### Flow

```
recording (webm/mp4 Blob)
   │  main thread
   ▼
decodeAudioData at 48000 Hz ──► round each channel to 16-bit ──► mono (average of channels)
   │  transfer to worker
   ▼
Web Worker
   ├─ soxr HQ ► 44100 Hz ► speaking style: rms, voiced share, pitch
   └─ soxr HQ ► 22050 Hz ► 40 MFCCs ► cut or pad to 91 frames ► model ► 6 scores ► 3 scores
   │
   ▼
EmotionResult  { emotions_3, emotions_6, speaking_style }
```

### Files

- `models/Audio_Emotion_Analysis/export_weights.py`: a one-time script. It reads `model3.h5` with `h5py` (no TensorFlow needed) and writes the weights to `frontend/public/voice/` as a raw little-endian float32 file plus a small JSON file naming each tensor, its shape and its offset. About 1.2 MB.
- `models/Audio_Emotion_Analysis/make_voice_fixtures.py`: runs the server's own functions (`get_mfccs`, `compute_confidence_features`, `simple_confidence_score`, the model) on test signals and writes the expected values for the tests.
- `frontend/src/lib/voice/`:
  - `index.ts`: `analyzeVoice(blob)` returns an `EmotionResult` or throws. Starts the worker on first use and reuses it.
  - `decode.ts`: main-thread decoding at 48000 Hz, rounding each channel to 16-bit as ffmpeg's WAV output does, then averaging to mono, the same order as the server.
  - `voice.worker.ts`: runs everything below off the main thread.
  - `soxr.ts`: loads the soxr WebAssembly file and resamples, then pads or trims to librosa's length, `ceil(length × ratio)`.
  - `fft.ts`, `mfcc.ts`, `speaking.ts`, `model.ts`: the processing steps.
  - `constants.ts`: class names and the numbers copied from the server.
- `frontend/src/pages/Interview.tsx`: `analyzeEmotion` calls `analyzeVoice` instead of `fetch`. The pending-results list, the 8-second wait and the rule that failures only log to the console stay as they are. The weights and the soxr file are requested when the interview starts, so the first answer does not wait for them. `API_BASE_URL2` and the `VITE_EMOTION_API` use go away. `serviceAuthHeaders` stays, because four other calls on that page use it.
- A repeatable browser comparison, based on the throwaway test (headless Chrome with a fake microphone, then the server's own Python code on the same recordings), so it can be re-run after any change. It lives outside `frontend/src`.

### Resampler

The server resamples with soxr at HQ quality (librosa's default, `soxr_hq`, through python-soxr 1.1.0). The browser uses the same C library compiled to WebAssembly.

- **First choice:** take the two built files, `soxr_wasm.js` and `soxr_wasm.wasm` (about 190 KB), from the npm package `wasm-audio-resampler` 2.0.0, pinned and committed with their licenses. Do not add the package or its `threads` dependency. Its wrapper calls `soxr_create` with float input and output, `SOXR_HQ` and flags 0, the same settings python-soxr uses for `HQ`. Its glue code is CommonJS and finds its `.wasm` through `document.currentScript`, which does not exist in a worker. Pass the `.wasm` bytes in directly (Emscripten's `wasmBinary` option) and load the glue in a way that works inside the worker.
- **First task of the build, a gate:** feed the same samples to python-soxr and to this file, and compare. Every output sample must be within 1e-5, and the lengths must match after librosa's padding or trimming.
- **If the gate fails:** build libsoxr from its official source with Emscripten, at the version python-soxr bundles. This needs the Emscripten toolchain installed, so ask the owner first.
- **Last resort:** a resampler written in TypeScript, with the looser bars that the test measured (largest probability difference about 0.022). Only with the owner's agreement.
- **License:** the wrapper is MIT, and libsoxr inside it is LGPL-2.1 or later. Keep it as a separate, replaceable file with its license and a link to its source, and name it in the README. This is not legal advice. The owner should confirm it suits the project.

### Recordings that are not 48 kHz

Opus, which Chrome and Firefox record, always decodes at 48 kHz, so decoding at 48 kHz in the browser matches what ffmpeg gives the server. MP4/AAC from Safari can be 44.1 or 48 kHz. The server would use the file's own rate, while `decodeAudioData` resamples to whatever rate the context asks for. If the rate can be read from the file's header simply, decode at that rate. Otherwise decode at 48 kHz, measure the difference on a Safari recording and report it. Builder's call.

### Processing steps, copied from the server

The numbers below are what the server uses today. The builder must read each librosa 0.10.1 function in the installed `.venv` and match it, not rely on this summary.

**Model input**
1. Audio at 22050 Hz, mono.
2. Short-time Fourier transform: 2048-point window, hop 512, Hann window, centred, zero padding at the edges.
3. 128 mel bands, power spectrum, converted to decibels, then a DCT keeping 40 coefficients (`n_mfcc=40`).
4. Cut to the first 91 frames, or pad with zeros to 91. The input is a 40 × 91 matrix. Do not transpose it: 40 is the length and 91 the channel count of the first convolution.
5. 91 frames cover about 2.09 seconds, so the emotion readings use only the start of each answer. This is how the server works today and is kept. Processing only the first few seconds for this branch is allowed if the parity numbers hold.

**Model**: Conv1D(256, kernel 5, same) → ReLU → MaxPool(8) → Conv1D(128, kernel 5, same) → ReLU → MaxPool(4) → Flatten (128 values) → Dense(64, no activation) → Dense(6) → softmax. Dropout does nothing at prediction time.

**Outputs**
- Six classes in the order fear, angry, neutral, happy, sad, surprise.
- Three classes: positive = p3 + 0.5·p5, neutral = p2 + 0.5·p5 + 0.5·p4, negative = p0 + p1 + 0.5·p4.
- `emotion` is the highest class, `confidence` its score, `predictions` all scores by name.

**Speaking style** (a hand-written formula, not a trained model), on audio at 44100 Hz:
- `energy` is the mean of librosa's `rms`.
- `voiced_ratio` is the non-silent duration from `effects.split(top_db=30)` divided by the total duration.
- `pitch_mean` and `pitch_std` come from `yin(fmin=50, fmax=400)`, keeping values above 0. librosa's `yin` uses two forward and one inverse 2048-point FFT per frame.
- `score = 0.4·min(energy/0.05, 1) + 0.4·min(voiced_ratio/0.7, 1) + 0.2·(1 − min(pitch_std/60, 1))`. `confident` at 0.5 or more, otherwise `anxious`.

### The pitch behavior that is copied on purpose

The server calls `librosa.yin(y, fmin=50, fmax=400)` on 44100 Hz audio without passing the sample rate, so librosa assumes 22050 Hz. Measured on 200 Hz and 400 Hz test tones, the server reports 100 Hz and 200 Hz. By calculation its search window is really 100 to 800 Hz (the edges were not tested). Only `pitch_std` enters the score, so the "stable pitch" part (20% of the score) reads too favorable.

The TypeScript version reproduces this exactly. The assumed rate lives in one named constant, `YIN_ASSUMED_SAMPLE_RATE = 22050`, with a comment explaining that it copies the server. Fixing it, in both places or only in the browser, is a separate follow-up change, because it changes the scores people see.

### Failure behavior

Any failure (decoding, an unsupported format, an empty recording, the soxr file not loading, a worker error) is logged to the console and gives no result for that answer, the same as a failed server call today. `summarizeEmotions` already averages only what it has.

There is no fallback to the server. Keeping one would keep the dependency this change removes. The old code stays in git history.

### Dependencies and tooling (my calls)

- Add `vitest` as a dev dependency of the frontend, with a `test` script. It needs no extra build setup because the project already uses Vite.
- No new runtime dependency. The two soxr files are committed, not installed. A small FFT is written in `fft.ts`, including a real-input version for the pitch step.
- The worker is created with `new Worker(new URL("./voice.worker.ts", import.meta.url), { type: "module" })`, which Vite bundles.

### Docs

Update these so they no longer say the browser calls the emotion service: `README.md` (including the soxr license note), `docs/architecture.md`, `docs/mock-interviews.md`, `docs/setup.md`, `docs/deployment.md`, `docs/troubleshooting.md`, `docs/emotion-service.md` (a note that the app no longer calls it) and `frontend/exampleENVLOCAL.txt`. The service's deployment steps stay, marked optional. `deploy/`, `render.yaml` and the Python service are not changed.

## Testing

The main risk is different predictions with no visible error. The Python code is the reference, run from `models/Audio_Emotion_Analysis/.venv`. Each stage is compared separately, so a difference can be traced to one place.

The bars below come from the browser test. If one has to change, the reason and the numbers are recorded here and shown to the owner.

| Stage | Compared on | Bar |
|---|---|---|
| soxr | The same samples through python-soxr and the WebAssembly file, 48000 to 22050 and to 44100 Hz | Every sample within 1e-5, same length |
| Model | The same 40 × 91 matrices (random ones and real ones) through TensorFlow and the TypeScript model | Each probability within 1e-5 |
| MFCCs | The same 22050 Hz samples through librosa and the TypeScript code | Largest coefficient difference 0.01 (librosa works in float32) |
| Speaking features | The same 44100 Hz samples | `energy` within 0.1%, `voiced_ratio` within one frame, `pitch_mean` and `pitch_std` within 1%, `score` within 0.005 |
| Whole pipeline | Browser recordings: the full browser pipeline against the server's code on the same file | Same top emotion on every clip, each probability within 0.001, same speaking label, score within 0.005 |

Also required:
- **Test signals in the repo**: deterministic ones made by a script (tones, sweeps, noise, silence, very short and long signals) and their expected values. No speech audio is committed.
- **Edge cases**: silence, audio shorter than 2048 samples, under half a second, a 3-minute answer, stereo input. For each, note what the server does (a result, a 400 or a 500) and match it: a result where the server gives one, no result where it fails.
- **Browser recordings** (my call): headless Chrome with a fake microphone fed from speech files, as in the test, kept in a gitignored folder. At the end the owner adds a few clips in their own voice for a final check. Firefox and Safari are checked if available, and any gap is reported.
- **Speed**: a 60-second answer is analyzed in under 2 seconds on an ordinary laptop, the page stays responsive while it runs, and results are ready inside the 8-second wait. Timings are measured in the browser and reported, not assumed.
- **Build checks**: `npm run build` and `npm run lint` pass in `frontend/`.

## Known limits

- The emotion readings use only the first ~2.1 seconds of each answer. Analyzing the whole answer in short segments would be a later change with its own testing.
- The pitch value is half the real pitch until the follow-up fix.
- The model's accuracy is unmeasured here, as the README already says.

## Left to the builder

- How to load the soxr glue code inside the worker.
- Whether to read the sample rate of non-Opus recordings from the file header.
- The file names inside the folders above.
- Reading each librosa function in the installed version and matching it.

## As built

- **Removal.** When approving, the owner asked for the code that is no longer wanted to be removed. The Flask service, `model4.h5`, `model_mw.h5`, its Dockerfile and its Compose, Caddy, keep-alive and Render entries are gone, and `models/Audio_Emotion_Analysis` keeps only the model, `reference.py` and the tools that make and check the fixtures. `reference.py` was checked against the running Flask endpoint before `main.py` was removed: identical results on five browser recordings.
- **soxr loader.** Only `soxr_wasm.wasm` is vendored. Its Emscripten loader script is not: `soxr.ts` provides the eight host functions the module needs (memory copy, heap growth, time and five stubs), which works the same in the worker and in Node tests.
- **Gate.** Passed. The WebAssembly build is within 3e-7 of python-soxr per sample, although python-soxr bundles a modified libsoxr (0.1.3-14-ga66f3ee) and the WebAssembly file is built from the original.
- **Full-file processing.** librosa's `power_to_db` clips at 80 dB below the loudest frame of the whole answer, so the MFCC step processes every frame even though the model reads only the first 91.
- **Measured results** are in [docs/voice-analysis.md](../../voice-analysis.md#how-it-is-tested).
