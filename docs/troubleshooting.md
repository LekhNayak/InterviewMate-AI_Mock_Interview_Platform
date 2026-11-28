# Troubleshooting

## Starting the services

| Symptom | Cause and fix |
|---|---|
| Resume or JD upload fails with `Missing GROQ_API_KEY in the API .env` | No Groq key is set. Add `GROQ_API_KEY` to `backend/.env`. |
| Logs show `[groq] GROQ_API_KEY failed (429), trying GROQ_API_KEY_2` | That key hit its rate limit and the next one was used. Nothing to fix unless every key fails. |
| `Database connection failed` | Check `MONGO_URI`. The server stays up and `/health` reports the database state. |
| PowerShell says running scripts is disabled | Your execution policy blocks `npm.ps1`. Use `npm.cmd` and `npx.cmd` in place of `npm` and `npx`. |
| `There is no .venv in …` | That Python service is not set up. Run `npm run setup:python`, or `npx turbo run setup --filter=<package>` for one. |
| Vite starts on port 8081 and requests fail | Another program holds port 8080, often an earlier `npm run dev`. The API only accepts the app from port 8080, so stop the other one. |
| `Cannot find module` after pulling | Dependencies changed. Run `npm install` in the repository root, not in a package folder. |
| Vite fails on an old Node version | Use Node 20.19 or later, or 22.13 or later. |
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
| `File too large` | PDFs and `.tex` files can be up to 4 MB. |
| `AI response was truncated` | The document is too long to parse in one pass. Shorten it. |
| Groq error 413 or 429 | The request is over your Groq limit. Parsing is sized for 8,000 tokens per minute. Wait a minute and retry. |
| `This resume has no PDF` in the Resume Analyzer | It was made from scratch. Upload it as a PDF to analyze it. |

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
| `Analysis failed` in the Resume Analyzer | Check that the ATS service is running and that `ML_SERVER` is `http://localhost:6050`. Port 5000 is the interview service. |
| The first analysis times out | The embedding model downloads on first use and the backend waits 60 seconds. Try again. |
| `The AI analysis failed` or `The AI service is busy` | The Groq calls in the ATS service failed. Check its `GROQ_API_KEY`, add backup keys, and try again in a minute. |
| ATS results show no feedback text | Only the feedback step failed. The score and evidence are still right; run it again later for the text. |
| `No text could be read from this PDF` | The resume is a scan or an image. Export it from a text editor instead. |
| Find Jobs shows only remote jobs "via Himalayas" | SerpApi failed or is out of searches. Check `SERPAPI_KEY` and the usage on serpapi.com. |
| Dashboard asks for a Codeforces or LeetCode URL | Add profile URLs in the form `https://codeforces.com/profile/<name>` and `https://leetcode.com/u/<name>`. |
