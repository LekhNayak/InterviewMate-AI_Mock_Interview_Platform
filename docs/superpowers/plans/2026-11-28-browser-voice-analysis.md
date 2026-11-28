# Voice analysis in the browser: plan

Design: [2026-11-28-browser-voice-analysis-design.md](../specs/2026-11-28-browser-voice-analysis-design.md), approved by the owner on 2026-11-28, with one addition from the owner: remove the code that is no longer wanted. That means the Flask emotion service and its deployment, kept only as a small Python reference that the tests compare against.

Each task ends with its check passing before the next one starts.

1. **Python reference.** `models/Audio_Emotion_Analysis/reference.py` holds the server's functions, copied unchanged from `main.py`. Check: it gives the same numbers as `main.py` on the recordings from the browser test.
2. **soxr gate.** Vendor `soxr_wasm.wasm` from `wasm-audio-resampler` 2.0.0 with its licenses, load it with our own small loader (no glue script), add `vitest`. Check: every sample within 1e-5 of python-soxr, same lengths. If not, stop and ask the owner (build the soxr fork python-soxr uses, or a TypeScript resampler).
3. **Model.** `export_weights.py` writes the weights. `model.ts` runs them. Check: probabilities within 1e-5 of TensorFlow.
4. **MFCCs.** `mfcc.ts`. Check: within 0.01 of librosa, including frame counts for odd lengths.
5. **Speaking style.** `speaking.ts` with the copied pitch behavior. Check: the bars in the design.
6. **Whole pipeline.** `pcm.ts` (16-bit rounding, mono) and `analyze.ts`. Check: the same result as the reference on test signals and edge cases (silence, very short, stereo).
7. **App.** Worker, `index.ts`, `Interview.tsx`. Check: `npm run build`, `npm run lint`.
8. **Removal.** The Flask service, the unused models, its Docker, Compose, Caddy, keep-alive and Render entries, the npm workspace entry, `VITE_EMOTION_API`. Check: nothing references them (search), the lockfile is updated.
9. **Docs.** Replace `docs/emotion-service.md` with `docs/voice-analysis.md` and update the others.
10. **Browser check.** The browser comparison and speed measurement in headless Chrome. Check: the whole-pipeline bars, under 2 s for 60 s.
11. **Hand-over.** Report results and give the owner a commit message. No commit.
