# Troubleshooting

## Starting the services

| Symptom | Cause and fix |
|---|---|
| Backend stops with `GROQ_API_KEY environment variable is missing or empty` | The Groq client is created at startup. Put any value in `backend/.env` to boot, and a real key to parse PDFs. |
| `Database connection failed` | Check `MONGO_URI`. The server stays up and `/health` reports the database state. |
| PowerShell says running scripts is disabled | Your execution policy blocks `npm.ps1` and venv activation. Use `npm.cmd` in place of `npm`, and run `.venv\Scripts\python` directly as the setup guide does. |
| Vite fails on an old Node version | Use Node 20.19 or later, or 22.12 or later. |
| Emotion service cannot open `model3.h5` | Run it from `models/Audio_Emotion_Analysis`. |
| Port 5000 is taken | Set another `PORT` for the interview service and update `VITE_INTERVIEW_API`. If `PORT` is missing from `backend/.env`, the backend uses 5000 too. |

## Signing in

| Symptom | Cause and fix |
|---|---|
| The Demo Account is rejected | Run `node seedDemoUser.js` in `backend`. |
| Requests answer 401 | You are not signed in, or the cookie expired after 7 days. Leave `NODE_ENV` unset locally, because `production` marks the cookie `Secure`, which needs HTTPS. |
| CORS error in the console | Open the app at `http://localhost:8080`, not `127.0.0.1`. Other origins must be in the list in `backend/src/index.js`. |
| `Failed to send OTP` | `EMAIL_USER` and `EMAIL_PASS` must be a Gmail address and an app password. Use the demo account to skip email. |
| Still signed in after **Log Out** | The button clears browser storage and leaves the cookie. Clear the site's cookies. |

## Uploads and parsing

| Symptom | Cause and fix |
|---|---|
| JD upload answers 500 with `ENOENT ... tempUploads` | Create `backend/tempUploads`. In Docker: `docker compose exec backend mkdir -p tempUploads`. |
| `bad XRef entry` | `pdf-parse` can fail or return the wrong text on PDFs smaller than about 4 KB. Use a normal export of the document. |
| `AI response was truncated` | The document is too long to parse in one pass. Shorten it. |
| Groq error 413 or 429 | The request is over your Groq limit. Parsing is sized for 8,000 tokens per minute. Wait a minute and retry. |
| `Could not save resume` | The resume is new to this page. Reload first if you uploaded it. Resumes made from scratch cannot be saved, see [Known problems](resume-and-ats.md#known-problems). |
| A resume with no name, phone or email fails to upload | Those fields are required. |
| A DOCX resume fails | Only PDF is parsed. |

## Interviews

| Symptom | Cause and fix |
|---|---|
| **Start AI Interview** does nothing | The page was opened directly, so it has no role or resume. Start from **Simulations**. |
| Replies have no sound | Check `SARVAM_API_KEY`, then the interview service log for `Sarvam TTS failed`. |
| The interview ended after one or two questions | A reply contained a closing phrase such as "thank you". See [Mock interviews](mock-interviews.md#session-states). |
| `Expecting value` after the last answer | The feedback was not valid JSON. Send any message to try again. |
| The interview is missing from Reviews | It is saved when you choose **Get Feedback**. |

## ATS and jobs

| Symptom | Cause and fix |
|---|---|
| `Analysis failed` in the ATS Checker | Check that the ATS service is running and that `ML_SERVER` is `http://localhost:6050`. Port 5000 is the interview service. |
| The first analysis times out | The embedding model downloads on first use and the backend waits 60 seconds. Try again. |
| JD Match shows `N/A` | The Groq call in the ATS service failed. Check its `GROQ_API_KEY`. |
| `Job fetch failed` | Check `RAPIDAPI_KEY` and your RapidAPI quota. |
| Dashboard shows `Loading Codeforces data` or `Loading LeetCode data` | Add profile URLs in the form `https://codeforces.com/profile/<name>` and `https://leetcode.com/u/<name>`. |

## Git

`git status` shows changed files under `models/Interview api_service/data` after an interview. The service writes to tracked files. Restore them with:

```bash
git checkout -- "models/Interview api_service/data"
```
