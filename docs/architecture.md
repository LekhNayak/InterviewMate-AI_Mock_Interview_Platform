# Architecture

InterviewMate is a React frontend, an Express API and three Flask services. The diagrams of the whole system and of one interview are in the [README](../README.md#architecture). This page covers the parts behind them.

## Who talks to whom

| From | To | Login checked |
|---|---|---|
| Browser | Express API | Yes, by JWT cookie, on every route except sign-up, login, the demo routes, logout, `GET /api/companies` and `/health` |
| Browser | Interview service | By a short-lived token from the API, if `SERVICE_TOKEN_SECRET` is set. A session then belongs to the user who started it. Audio files are public under random names. |
| Browser | Emotion service | By the same token |
| Express API | ATS service | By a 5-minute token the API signs for each request, if `SERVICE_TOKEN_SECRET` is set |
| Browser | Codeforces API, a public LeetCode API | Not applicable. These are public profile lookups for the dashboard. |

## Repository layout

```
frontend/                         React app (Vite)
  src/pages/                      Landing, Auth, Dashboard, Interview, JdOnboarding, Reviews, NotFound
  src/components/DashboardContent/  Dashboard tabs: home, simulations, resume, ATS, jobs
  src/components/Resume/          Resume list, editor and preview
  src/components/progress/        Codeforces and LeetCode cards
  src/components/profile/         Interview calendar and skill links
backend/                          Express API
  src/index.js                    App entry, CORS list, route mounting
  src/routes/ src/handlers/       One file per area: user, parser, jd, ats, interview, company, jobs
  src/models/                     Mongoose schemas
  src/middleware/                 Login check, Multer upload
  src/utils/groqJson.js           Token budget and JSON parsing for Groq replies
  src/utils/pdfText.js            Text extraction from PDFs
  src/config/                     MongoDB, Cloudinary, cookie and mail settings
models/
  Interview api_service/          Interview service: sessions, questions, speech, feedback
  Resume ATS and JD/api_service/  ATS service: ats_core/ scoring engine, optional semantic/ embeddings
  Audio_Emotion_Analysis/         Emotion service: three Keras models
deploy/                           Docker Compose, Caddyfile and keep-alive script
render.yaml                       Alternative Render deployment
package.json, package-lock.json   npm workspace of the five packages, with one lockfile
turbo.json                        Turborepo tasks: build and lint (cached), dev, setup
scripts/python.mjs                Sets up and runs a Python service with its own .venv
```

Each Python service has a small `package.json` with `setup` and `dev` scripts, so Turborepo runs it like the Node packages. The services still install with `pip` from their `requirements.txt`.

The **Resume Building** tab is `DashboardContent/ResumeBuilder.tsx`. The dashboard calendar is built from saved interviews.

## Accounts and sessions

1. `POST /api/user/signup/request-otp` creates a six-digit code, emails it through Gmail and stores it in MongoDB, which deletes it after 5 minutes. A new code can be requested once a minute.
2. `POST /api/user/signup/complete` checks the code, with at most 5 attempts per code, hashes the password with bcrypt (cost 12) and sets the login cookie.
3. The cookie is called `token`, is HTTP-only and holds a JWT that expires after 7 days. In production it is `Secure` and `SameSite=None`. Locally it is `SameSite=Lax`.
4. `userAuth` in [auth.middleware.js](../backend/src/middleware/auth.middleware.js) reads the cookie, loads the user and answers 401 if any step fails.
5. `POST /api/user/demo-login` opens a session for the account named by `DEMO_EMAIL` without a password. That account cannot be deleted or have its password changed.
6. `GET /api/user/service-token` gives a signed-in user the token for the interview and emotion services.
7. `DELETE /api/user/delete` removes the account with its resumes, job descriptions, ATS results and interviews.

## Data model

All collections are in MongoDB through Mongoose.

| Model | Main fields |
|---|---|
| User | name, email, password (hash), age, gender, GitHub, LinkedIn, Codeforces and LeetCode URLs, skills, interests |
| OTP | email, otp, attempts, createdAt (expires after 300 seconds) |
| ParsedResume | userId, title, pdfUrl, source and sourceName (PDF, .tex or made in the builder), header (name, email, phone, location, links), sections, layout, importReport |
| JobDescription | url, title, company, location, description, requiredSkills, jobType, uploadedBy, isPublic |
| ATS | user, resume, jobDescription or jobRole, inputKey, score, verdict, style, report (the service's full answer), and older summary fields filled from it: jdMatch, missingKeywords, profileSummary, technicalSkillsMatch, softSkillsMatch, experienceAlignment, improvementSuggestions, projectsAnalysis, overallComment, localAtsScore |
| AtsRubric | key (JD and its last update, or a role), rubric. Unused rubrics expire after 90 days. |
| Interview | userId, type, interviewType, role, company, level, duration, transcript, feedback (rating, four scores, summary, strengths, areas, next steps, voice emotion), jdId, resumeId, optional video |
| Company | name, role, brief, type, mode, color, link, pdf. Not used by the frontend. |

A resume's `sections` are in order, and each is a paragraph, dated entries, skill groups or a list. [backend/src/utils/resumeFormat.js](../backend/src/utils/resumeFormat.js) defines the format and cleans every resume the API stores. Resumes saved before it have fixed fields (objective, education, skills, projects, activities), which are converted when read and removed on the next save.

A resume has a `pdfUrl` only if it was uploaded as a PDF. Clients cannot set `pdfUrl`, the owner or the import report. The app does not save `video`.

Live interview sessions are in the `interview_sessions` collection, written by the interview service, not the API. They hold the conversation and the generated feedback, and a TTL index deletes them 7 days after they start. The browser saves the finished interview through the API as an Interview.

## Files

| File | Stored in | Notes |
|---|---|---|
| Resume and JD PDFs | Cloudinary, as raw files with public URLs | Up to 4 MB. Uploaded `.tex` files are read and not kept. |
| Interviewer audio | Not kept | Sent inside each reply as a `data:` URL |
| Candidate recordings | Not kept | Both services delete them after the request |

The camera feed is only shown to the candidate. It is not uploaded or recorded.

## Models in use

| Task | Model | Settings |
|---|---|---|
| Resume import | `GROQ_MODEL`, default `openai/gpt-oss-120b` | Structured output with a strict JSON schema (JSON mode if the model has none), low reasoning effort, temperature 0.2, up to 6000 tokens within the 8000-per-minute budget, input cut at 16,000 characters |
| JD parsing | `GROQ_MODEL`, default `openai/gpt-oss-120b` | JSON mode, temperature 0.2, 3000 tokens, input cut at 16,000 characters |
| Interview questions and feedback | `GROQ_MODEL`, default `qwen/qwen3.8-27b` | Temperature 0.4, 350 tokens per question and 1200 for feedback, reasoning off for Qwen |
| Transcription | `whisper-large-v3-turbo` on Groq | |
| Interviewer voice | Sarvam `bulbul:v3`, speaker `ritu`, `en-IN` | Text split into chunks of up to 490 characters, synthesised in parallel and joined |
| ATS rubric, judgements and feedback | `GROQ_MODEL`, default `openai/gpt-oss-120b` | Structured JSON, temperature 0, seed 7, low reasoning effort; 2500, 3000 and 2200 tokens |
| ATS score | Calculated by code | Weighted parts; see [Resumes and the Resume Analyzer](resume-and-ats.md#what-the-score-means) |
| ATS semantic similarity (optional) | `all-MiniLM-L6-v2` | Only with `ATS_SEMANTIC=1`; cosine 0.15 to 0.65 maps to 0 to 100 |
| Voice emotion | `model3.h5`, `model4.h5`, `model_mw.h5` | MFCC features |

`groqJson.js` sizes the parsing calls for a limit of 8,000 tokens per minute on Groq's free tier.
