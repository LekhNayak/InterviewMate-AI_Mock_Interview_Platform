# Architecture

InterviewMate is a React frontend, an Express API and three Flask services. The diagrams of the whole system and of one interview are in the [README](../README.md#architecture). This page covers the parts behind them.

## Who talks to whom

| From | To | Login checked |
|---|---|---|
| Browser | Express API | Yes, by JWT cookie, on every route except sign-up, login, `/api/companies` and `/health` |
| Browser | Interview service | No. A random session id identifies the session. |
| Browser | Emotion service | No |
| Express API | ATS service | No. In the Docker setup it is not reachable from outside. |
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
  src/config/                     MongoDB, Cloudinary, cookie and mail settings
models/
  Interview api_service/          Interview service: sessions, questions, speech, feedback
  Resume ATS and JD/api_service/  ATS service: score, report, similar resumes
  Audio_Emotion_Analysis/         Emotion service: three Keras models
deploy/                           Docker Compose, Caddyfile and keep-alive script
render.yaml                       Alternative Render deployment
```

The **Resume Building** tab is `DashboardContent/test.tsx`. `Resume.tsx`, `Performance.tsx`, `Settings.tsx` and `Support.tsx` in the same folder are not reachable from the sidebar. `config/firebase.js` is an empty stub left from before the move to Cloudinary. `routes/interviewcalender.routes.js` exists but is not mounted. The dashboard calendar is built from saved interviews instead.

## Accounts and sessions

1. `POST /api/user/signup/request-otp` creates a six-digit code, stores it in MongoDB and emails it through Gmail. MongoDB deletes it after 5 minutes.
2. `POST /api/user/signup/complete` checks the code, hashes the password with bcrypt (cost 12) and sets the login cookie.
3. The cookie is called `token`, is HTTP-only and holds a JWT that expires after 7 days. In production it is `Secure` and `SameSite=None`. Locally it is `SameSite=Lax`.
4. `userAuth` in [auth.middleware.js](../backend/src/middleware/auth.middleware.js) reads the cookie, loads the user and answers 401 if any step fails.

## Data model

All collections are in MongoDB through Mongoose.

| Model | Main fields |
|---|---|
| User | name, email, password (hash), age, gender, GitHub, LinkedIn, Codeforces and LeetCode URLs, skills, interests |
| OTP | email, otp, createdAt (expires after 300 seconds) |
| ParsedResume | userId, title, pdfUrl, header, objective, education, skills, projects, activities |
| JobDescription | url, title, company, location, description, requiredSkills, jobType, uploadedBy, isPublic |
| ATS | user, resume, jobDescription or jobRole, jdMatch, missingKeywords, profileSummary, technicalSkillsMatch, softSkillsMatch, experienceAlignment, improvementSuggestions, projectsAnalysis, overallComment, localAtsScore, topResumes |
| Interview | userId, type, interviewType, role, company, level, duration, transcript, feedback (rating, four scores, summary, strengths, areas, next steps), optional jdId, resumeId and video |
| Company | name, role, brief, type, mode, color, link, pdf. Not used by the frontend. |

The app saves interviews without `jdId`, `resumeId` or `video`.

Live interview sessions are not in MongoDB. The interview service keeps them in JSON files until the browser saves the finished transcript through the API.

## Files

| File | Stored in | Notes |
|---|---|---|
| Resume and JD PDFs | Cloudinary, as raw files with public URLs | JD uploads also leave a copy in `backend/tempUploads` |
| Interviewer audio | `static/recordings` in the interview service | One WAV per reply |
| Candidate recordings | Not kept | Deleted after transcription. The emotion service keeps the last one until the next request. |

The camera feed is only shown to the candidate. It is not uploaded or recorded.

## Models in use

| Task | Model | Settings |
|---|---|---|
| Resume and JD parsing | `GROQ_MODEL`, default `openai/gpt-oss-120b` | JSON mode, temperature 0.2, 3000 tokens, input cut at 16,000 characters |
| Interview questions and feedback | `GROQ_MODEL`, default `qwen/qwen3.6-27b` | Temperature 0.4, 350 tokens, reasoning off for Qwen |
| Transcription | `whisper-large-v3-turbo` on Groq | |
| Interviewer voice | Sarvam `bulbul:v3`, speaker `ritu`, `en-IN` | Text split into chunks of up to 490 characters, synthesised in parallel and joined |
| ATS report | `GROQ_MODEL`, default `openai/gpt-oss-120b` | Temperature 0.2, 1024 tokens |
| ATS score | `all-MiniLM-L6-v2` | Cosine similarity times 150, capped at 99 |
| Voice emotion | `model3.h5`, `model4.h5`, `model_mw.h5` | MFCC features |

`groqJson.js` sizes the parsing calls for a limit of 8,000 tokens per minute on Groq's free tier.
