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
| The Demo Account box is missing | Set `DEMO_EMAIL` in `backend/.env`, run `node seedDemoUser.js` and restart the backend. |
| Requests answer 401 | You are not signed in, or the cookie expired after 7 days. Leave `NODE_ENV` unset locally, because `production` marks the cookie `Secure`, which needs HTTPS. |
| CORS error in the console | Open the app at `http://localhost:8080`, not `127.0.0.1`. Other origins must be in the list in `backend/src/index.js`. |
| `Failed to send OTP` | `EMAIL_USER` and `EMAIL_PASS` must be a Gmail address and an app password. Use the demo account to skip email. |
| `A code was just sent` or `Too many wrong codes` | One code per minute, and 5 attempts per code. Wait a minute and request a new one. |

## Uploads and parsing

| Symptom | Cause and fix |
|---|---|
| `Only PDF files are supported` | Export the document as a PDF. Other formats are not parsed. |
| `File too large` | PDFs can be up to 10 MB. |
| `AI response was truncated` | The document is too long to parse in one pass. Shorten it. |
| Groq error 413 or 429 | The request is over your Groq limit. Parsing is sized for 8,000 tokens per minute. Wait a minute and retry. |
| `This resume has no PDF` in the ATS Checker | It was made from scratch. Upload it as a PDF to analyze it. |

## Interviews

| Symptom | Cause and fix |
|---|---|
| `Sign in to use this service` or `Invalid or expired token` | `SERVICE_TOKEN_SECRET` differs between the backend and the service, or the token is older than 3 hours. Reload the page. |
| Replies have no sound | Check `SARVAM_API_KEY`, then the interview service log for `Sarvam TTS failed`. |
| `The feedback could not be generated` | The model did not return valid JSON twice. Choose **Get Feedback** to try again. |
| The interview is missing from Reviews | It is saved when the feedback arrives. Stay on the page until **View Feedback** appears. |
| No voice section in the feedback | No answer was recorded, or the emotion service is not running. |

## ATS and jobs

| Symptom | Cause and fix |
|---|---|
| `Analysis failed` in the ATS Checker | Check that the ATS service is running and that `ML_SERVER` is `http://localhost:6050`. Port 5000 is the interview service. |
| The first analysis times out | The embedding model downloads on first use and the backend waits 60 seconds. Try again. |
| JD Match shows `N/A` | The Groq call in the ATS service failed. Check its `GROQ_API_KEY`. |
| `Job fetch failed` | Check `RAPIDAPI_KEY` and your RapidAPI quota. |
| Dashboard asks for a Codeforces or LeetCode URL | Add profile URLs in the form `https://codeforces.com/profile/<name>` and `https://leetcode.com/u/<name>`. |
