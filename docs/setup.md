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
| Sign in with the demo account | Backend, frontend | MongoDB, `DEMO_EMAIL`. `GROQ_API_KEY` must not be empty or the backend will not start. |
| Create an account | Backend, frontend | `EMAIL_USER`, `EMAIL_PASS` |
| Upload a resume or job description | Backend, frontend | Groq, Cloudinary |
| Mock interview | Backend, frontend, interview | Groq, Cloudinary. Sarvam for the spoken voice. |
| ATS Checker | Backend, frontend, ATS | Groq, Cloudinary |
| Find Jobs | Backend, frontend | RapidAPI |
| Voice emotion in feedback | Emotion, with the mock interview services | None |

## Express API

The commands are the same in bash and PowerShell.

```bash
cd backend
npm ci
cp exampleENV.txt .env
```

Edit `backend/.env`:

| Variable | Value |
|---|---|
| `MONGO_URI` | Connection string, for example `mongodb://127.0.0.1:27017/interviewmate` |
| `PORT` | `8000` |
| `SECRET_KEY` | Any long random string. Signs the login cookie. |
| `GROQ_API_KEY` | Groq key. Used to turn resume and JD PDFs into fields. |
| `GROQ_MODEL` | `openai/gpt-oss-120b` |
| `RAPIDAPI_KEY` | Key for the Fresh LinkedIn Scraper API on RapidAPI |
| `EMAIL_USER`, `EMAIL_PASS` | Gmail address and app password. The mailer uses Gmail only. |
| `ML_SERVER` | `http://localhost:6050` |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Cloudinary account that stores the PDFs |
| `DEMO_EMAIL` | Account opened by the **Demo Account** box. Leave empty to hide the box. |
| `SERVICE_TOKEN_SECRET` | Optional. See [Service tokens](#service-tokens). |
| `NODE_ENV` | Leave unset locally. `production` makes the login cookie `Secure` and `SameSite=None`, which needs HTTPS. |

Create the demo account, then start the server:

```bash
node seedDemoUser.js
npm run dev
```

`seedDemoUser.js` creates the account named by `DEMO_EMAIL`. It gets a random password unless you set `DEMO_PASSWORD`, and running it again resets the password. Visitors open it without one: the **Demo Account** box asks the server for a session. The demo account cannot be deleted and its password cannot be changed in the app.

`seedSimulations.js` adds one public job description owned by the demo account.

Check the server:

```bash
curl http://localhost:8000/health
```

It answers `{"server":"up","db":"connected"}`. If MongoDB is unreachable the server stays up and reports another `db` state.

## Interview service

macOS or Linux (bash):

```bash
cd "models/Interview api_service"
python3.11 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
cp exampleENV.txt .env
.venv/bin/python interview_service.py
```

Windows (PowerShell):

```powershell
cd "models/Interview api_service"
py -3.11 -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
cp exampleENV.txt .env
.venv\Scripts\python interview_service.py
```

In Git Bash on Windows, use `py -3.11` to create the environment and `.venv/Scripts/python` to run it.

Fill in `.env` before the last command:

| Variable | Value |
|---|---|
| `GROQ_API_KEY` | Groq key. Used for questions, feedback and Whisper transcription. |
| `GROQ_MODEL` | `qwen/qwen3.6-27b` |
| `SARVAM_API_KEY` | Sarvam key for the interviewer's voice. Without it, interviews run as text. |
| `PORT` | `5000` |
| `SERVICE_TOKEN_SECRET` | Optional. See [Service tokens](#service-tokens). |
| `FLASK_DEBUG` | Optional. `1` turns on the Flask debugger, which runs code for anyone who can reach the port. Never set it on a shared network. |

This service writes sessions to `data/*.json` and audio to `static/recordings/`. Both are gitignored.

Running the file directly uses Flask's development server on all network interfaces. Use gunicorn on any shared or public network, as the Dockerfile does.

## ATS service

Same steps in `models/Resume ATS and JD/api_service`. The last command runs `main.py`.

| Variable | Value |
|---|---|
| `GROQ_API_KEY` | Groq key for the written report |
| `GROQ_MODEL` | `openai/gpt-oss-120b` |
| `PORT` | Optional, default `6050` |
| `RESUME_DB_PATH` | Optional. Folder of the ChromaDB index to search. Must already exist. |
| `PLACED_RESUME_PATH` | Optional, read by `build_database.py` only. Folder of PDFs to index. |

The install includes PyTorch and is large. The first analysis downloads the `all-MiniLM-L6-v2` model. `build_database.py` rebuilds the index from a folder of PDFs.

## Emotion service

Same steps in `models/Audio_Emotion_Analysis`. The last command runs `main.py`. `.env` is optional and holds only `SERVICE_TOKEN_SECRET`. `PORT` is optional and defaults to `8090`.

Run it from its own folder, because it loads the `.h5` models by relative path.

## Frontend

```bash
cd frontend
npm ci
cp exampleENVLOCAL.txt .env.local
```

The file sets `VITE_API_BASE_URL`, `VITE_INTERVIEW_API` and `VITE_EMOTION_API` to the local ports above.

```bash
npm run dev
```

Vite reads these values when it starts, so restart it after a change. `npm run build` makes a production build. `npm run lint` runs ESLint.

## Service tokens

The browser calls the interview and emotion services directly. To limit them to signed-in users, set the same `SERVICE_TOKEN_SECRET` (32 characters or more) in three places:

| File | Service |
|---|---|
| `backend/.env` | Express API, which issues the tokens |
| `models/Interview api_service/.env` | Interview service |
| `models/Audio_Emotion_Analysis/.env` | Emotion service |

The API gives a signed-in user a token that lasts 3 hours, and the services reject requests without one. An interview session can then be read only by the user who started it. If the variable is empty, the services accept every request and print a warning when they start.

## If something fails

See [Troubleshooting](troubleshooting.md).
