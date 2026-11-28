# Voice analysis reference

The voice analysis now runs in the browser: [frontend/src/lib/voice](../../frontend/src/lib/voice). This folder holds what it is built and tested from. Nothing here is deployed.

| File | Purpose |
|---|---|
| `model3.h5` | The trained six-emotion model |
| `reference.py` | The old Flask service's analysis, copied unchanged. The browser results are compared with it. |
| `export_weights.py` | Writes the model weights to `frontend/src/lib/voice/assets/` |
| `make_fixtures.py` | Writes the expected values that `npm test -w frontend` checks |
| `browser_check.py` | Runs the browser analysis in headless Chrome on real recordings and compares it with `reference.py` |

Guide: [docs/voice-analysis.md](../../docs/voice-analysis.md).

## Set up

From this folder, with Python 3.11:

```bash
node ../../scripts/python.mjs setup
```

That creates `.venv` and installs `requirements.txt`, which includes TensorFlow.

## Use

```bash
.venv/Scripts/python export_weights.py     # only if model3.h5 changes (.venv/bin/python on macOS and Linux)
.venv/Scripts/python make_fixtures.py      # after changing reference.py, the signals or the library versions
.venv/Scripts/python browser_check.py recordings/
```

`browser_check.py` needs Chrome and the frontend dev server (`npm run dev -w frontend`). Put WAV recordings of speech in `recordings/`. Git ignores that folder, because voice recordings are personal data.
