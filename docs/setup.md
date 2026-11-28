# Setup

How to run every part of InterviewMate on your own machine. For the short version, see the [quick start](../README.md#quick-start).

## Requirements

| Tool | Version | Why |
|---|---|---|
| Node.js | 20.19 or later, or 22.13 or later | Required by Vite 7 and the lint tools. The backend image uses Node 20. |
| Python | 3.11 | Used by every Dockerfile and by `render.yaml`. The emotion service pins packages for it. |
| MongoDB | Local server or Atlas | Tested locally with MongoDB 8.0. |

## Ports

| Service | Folder | Port |
|---|---|---|
| Frontend | `frontend` | 8080 |
| Express API | `backend` | 8000 with the example `.env`. The code falls back to 5000 if `PORT` is not set. |
| Interview service | `models/Interview api_service` | 5000 |
| ATS service | `models/Resume ATS and JD/api_service` | 6050 |
| Emotion service | `models/Audio_Emotion_Analysis` | 8090 |

The API only accepts browser requests from `http://localhost:8080` and the production sites listed in [backend/src/index.js](../backend/src/index.js). Open the app at `localhost`, not `127.0.0.1`.

## What you need for each feature

| Feature | Services running | Keys |
|---|---|---|
| Sign in with the demo account | Backend, frontend | MongoDB, `DEMO_EMAIL`. |
| Create an account | Backend, frontend | `EMAIL_USER`, `EMAIL_PASS` |
| Upload a resume or job description | Backend, frontend | Groq, Cloudinary |
| Mock interview | Backend, frontend, interview | Groq, Cloudinary. Sarvam for the spoken voice. |
| Resume Analyzer | Backend, frontend, ATS | Groq, Cloudinary |
| Find Jobs | Backend, frontend | SerpApi key, or nothing for remote jobs only (Himalayas) |
| Voice emotion in feedback | Emotion, with the mock interview services | None |

## Install and run

The repository is an npm workspace run with [Turborepo](https://turborepo.com). It has five packages:

| Package | Folder |
|---|---|
| `frontend` | `frontend` |
| `backend` | `backend` |
| `interview-service` | `models/Interview api_service` |
| `ats-service` | `models/Resume ATS and JD/api_service` |
| `emotion-service` | `models/Audio_Emotion_Analysis` |

Install the frontend, the API and Turborepo once, from the repository root. There is one `package-lock.json`, at the root.

```bash
npm install
```

Then set up the Python services. Each gets its own `.venv`, made with Python 3.11, in its folder:

```bash
npm run setup:python
```

That installs TensorFlow and PyTorch, which are large. To set up one service, name its package: `npx turbo run setup --filter=interview-service`. [scripts/python.mjs](../scripts/python.mjs) does the work, the same way on Windows, macOS and Linux.

Run these from the root. The commands are the same in bash and PowerShell.

| Command | What it does |
|---|---|
| `npm run dev:web` | Starts the frontend and the API |
| `npm run dev:interview` | Also starts the interview service, which mock interviews need |
| `npm run dev` | Starts all five |
| `npm run build` | Builds the frontend. Turborepo caches it, so an unchanged build takes a moment. |
| `npm run lint` | Runs ESLint, also cached |

While services run, Turborepo shows each one's output on its own. Choose one with the arrow keys; Ctrl+C stops them all. To run any mix, filter by package name: `npx turbo run dev --filter=backend --filter=ats-service`.

A variable set in the shell reaches every service, and wins over the same variable in its `.env` file. Each folder also still works on its own: `npm run dev` inside it.

## Express API

```bash
cp backend/exampleENV.txt backend/.env
```

Edit `backend/.env`:

| Variable | Value |
|---|---|
| `MONGO_URI` | Connection string, for example `mongodb://127.0.0.1:27017/interviewmate` |
| `PORT` | `8000` |
| `SECRET_KEY` | Any long random string. Signs the login cookie. |
| `GROQ_API_KEY` | Groq key. Used to turn resume and JD PDFs into fields. |
| `GROQ_API_KEY_2`, `_3`, ... | Optional backup keys. See [Several Groq keys](#several-groq-keys). |
| `GROQ_MODEL` | `openai/gpt-oss-120b` |
| `SERPAPI_KEY` | Key for Find Jobs. See [Job search](job-search.md). |
| `EMAIL_USER`, `EMAIL_PASS` | Gmail address and app password. The mailer uses Gmail only. |
| `ML_SERVER` | `http://localhost:6050` |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Cloudinary account that stores the PDFs |
| `DEMO_EMAIL` | Account opened by the **Demo Account** box. Leave empty to hide the box. |
| `SERVICE_TOKEN_SECRET` | Optional. See [Service tokens](#service-tokens). |
| `NODE_ENV` | Leave unset locally. `production` makes the login cookie `Secure` and `SameSite=None`, which needs HTTPS. |

Create the demo account:

```bash
npm run seed:demo -w backend
```

This runs `seedDemoUser.js`, which creates the account named by `DEMO_EMAIL`. It gets a random password unless you set `DEMO_PASSWORD`, and running it again resets the password. Visitors open it without one: the **Demo Account** box asks the server for a session. The demo account cannot be deleted and its password cannot be changed in the app.

`npm run seed:simulations -w backend` adds one public job description owned by the demo account.

Start it with `npm run dev:web`, then check it:

```bash
curl http://localhost:8000/health
```

It answers `{"server":"up","db":"connected"}`. If MongoDB is unreachable the server stays up and reports another `db` state.

## Interview service

```bash
cp "models/Interview api_service/exampleENV.txt" "models/Interview api_service/.env"
```

Fill in `.env`:

| Variable | Value |
|---|---|
| `GROQ_API_KEY` | Groq key. Used for questions, feedback and Whisper transcription. |
| `GROQ_API_KEY_2`, `_3`, ... | Optional backup keys. See [Several Groq keys](#several-groq-keys). |
| `GROQ_MODEL` | `qwen/qwen3.8-27b` |
| `SARVAM_API_KEY` | Sarvam key for the interviewer's voice. Without it, interviews run as text. |
| `PORT` | `5000` |
| `MONGO_URI` | The same Atlas connection string as the API. Live sessions are stored in it. |
| `SERVICE_TOKEN_SECRET` | Optional. See [Service tokens](#service-tokens). |
| `FLASK_DEBUG` | Optional. `1` turns on the Flask debugger, which runs code for anyone who can reach the port. Never set it on a shared network. |

`npm run dev` runs the file directly, which uses Flask's development server on all network interfaces. Use gunicorn on any shared or public network, as the Dockerfile does.

## ATS service

Copy `exampleENV.txt` to `.env` in `models/Resume ATS and JD/api_service`. `npm run dev` runs `main.py`.

| Variable | Value |
|---|---|
| `GROQ_API_KEY` | Groq key for the rubric, the judgements and the feedback |
| `GROQ_API_KEY_2`, `_3`, ... | Optional backup keys. See [Several Groq keys](#several-groq-keys). |
| `GROQ_MODEL` | `openai/gpt-oss-120b` |
| `PORT` | Optional, default `6050` |
| `SERVICE_TOKEN_SECRET` | Optional. See [Service tokens](#service-tokens). |
| `ATS_WEIGHTS` | Optional. JSON that overrides scoring weights, such as `{"keywords": 0.3}` |
| `ATS_SEMANTIC` | Optional. `1` turns on the embedding engine, if it is installed |
| `RESUME_DB_PATH`, `PLACED_RESUME_PATH` | Optional, for the embedding engine's resume bank only |

`requirements.txt` is small and has no PyTorch. The optional embedding engine needs `pip install -r requirements-semantic.txt` and `ATS_SEMANTIC=1`; see [semantic/README.md](../models/Resume%20ATS%20and%20JD/api_service/semantic/README.md).

## Emotion service

In `models/Audio_Emotion_Analysis`, `npm run dev` runs `main.py`. `.env` is optional and holds only `SERVICE_TOKEN_SECRET`. `PORT` is optional and defaults to `8090`.

It loads the `.h5` models by relative path, so it must run from its own folder. `npm run dev` does that.

## Frontend

```bash
cp frontend/exampleENVLOCAL.txt frontend/.env.local
```

The file sets `VITE_API_BASE_URL`, `VITE_INTERVIEW_API` and `VITE_EMOTION_API` to the local ports above. Vite reads them when it starts, so restart it after a change.

`npm run build` uses `frontend/.env.production` instead, if that file exists. Turborepo passes `VITE_*` variables set in the shell to the build, as Vercel sets them; others do not reach it.

## Several Groq keys

The API, the interview service and the ATS service each accept more than one Groq key. Put the main key in `GROQ_API_KEY` and backups in `GROQ_API_KEY_2`, `GROQ_API_KEY_3` and so on. There is no limit, and the numbers do not have to be consecutive.

When Groq rejects a key (invalid, revoked or restricted) or it hits a rate or quota limit, the same request is sent with the next key in number order, and that key stays in use until it fails too. Other errors, such as a bad request or Groq being down, are reported at once, because another key would not help. The logs name the key that failed, never its value.

The code is in [backend/src/utils/groqClient.js](../backend/src/utils/groqClient.js) and in `groq_keys.py` in each Python service. The two Python copies must stay the same.

## Service tokens

The browser calls the interview and emotion services directly, and the API calls the ATS service. To limit them to signed-in users, set the same `SERVICE_TOKEN_SECRET` (32 characters or more) in four places:

| File | Service |
|---|---|
| `backend/.env` | Express API, which issues the tokens |
| `models/Interview api_service/.env` | Interview service |
| `models/Audio_Emotion_Analysis/.env` | Emotion service |
| `models/Resume ATS and JD/api_service/.env` | ATS service |

The API gives a signed-in user a token that lasts 3 hours, and signs a 5-minute token for each ATS request. The services reject requests without one. An interview session can then be read only by the user who started it. If the variable is empty, the services accept every request and print a warning when they start.

## If something fails

See [Troubleshooting](troubleshooting.md).
