# InterviewMate (Efos Virtual Hack) — Project Deep-Dive & Interview Prep

> A reconstruction of what you actually built, how it works end-to-end, the gap
> between your resume and the code, and likely interview questions + answers.

---

## 1. One-line pitch

**InterviewMate is an AI-powered interview-preparation platform.** A candidate uploads
their resume and a job description, picks an interview type/level/duration, and then does a
**live, voice-based mock interview** with an AI interviewer that speaks, listens, asks
adaptive follow-ups, and produces structured feedback + voice-emotion analysis. It also has
an **ATS resume-vs-JD scorer**, resume editor, job finder, and a performance dashboard.

---

## 2. The real architecture (this is bigger than your resume says)

It is a **microservices** system, not a single MERN app. Five deployable pieces:

```
┌─────────────────────────────────────────────────────────────────────┐
│  FRONTEND  — React 19 + Vite + TS + Tailwind + shadcn/ui             │
│  (Vercel)    Dashboard, Simulations, live Interview UI, ATS, Resume   │
└───────┬───────────────────────────────┬───────────────────┬─────────┘
        │ (auth, data, save sessions)    │ (live interview)  │ (emotion)
        ▼                                ▼                   ▼
┌────────────────────┐   ┌───────────────────────────┐  ┌────────────────────┐
│ NODE / EXPRESS API │   │ PY: Interview api_service │  │ PY: Audio_Emotion  │
│ (Express 5)        │   │ (Flask)                   │  │ _Analysis (Flask)  │
│ Mongo, JWT, OTP,   │   │ Groq LLM + Whisper STT +  │  │ Keras .h5 models   │
│ Cloudinary, PDF    │   │ Sarvam TTS. Session engine│  │ MFCC/mel-spec CNN  │
└─────────┬──────────┘   └───────────────────────────┘  └────────────────────┘
          │                          
          │              ┌───────────────────────────┐
          ▼              │ PY: Resume ATS and JD     │
   ┌─────────────┐       │ (Flask)                   │
   │  MongoDB    │       │ SentenceTransformers +    │
   │  Atlas      │       │ ChromaDB vector search +  │
   └─────────────┘       │ Groq LLM for ATS report   │
                         └───────────────────────────┘
```

### 2.1 Frontend — `frontend/`
- **React 19 + Vite + TypeScript**, Tailwind v4, **shadcn/ui** (Radix primitives), framer-motion.
- Routing: `react-router-dom` v7. Charts: `recharts`. PDF: `react-pdf` / `pdfjs-dist` / `jspdf` / `html2pdf`. OCR: `tesseract.js`.
- Auth/storage helpers: **Firebase** (`src/lib/firebaseConfig.ts`) and **Supabase** client.
- Key screens (`src/pages`, `src/components/DashboardContent`):
  - `Simulations.tsx` → configure a mock interview (role, company, JD, resume, level, duration, type).
  - `Interview.tsx` → **the live interview room** (webcam + chat + voice). ~930 lines, the heart of the product.
  - `ATSChecker.tsx` → resume vs JD score.
  - `Resume/` editor + preview, `Jobfinder.tsx`, `Performance.tsx`, `DashboardHome.tsx`, `interviewcalender.tsx`, LeetCode/Codeforces progress widgets.

### 2.2 Node / Express API — `backend/` (entry `src/index.js`)
- **Express 5**, **Mongoose** (MongoDB Atlas), **JWT** + **bcrypt** auth, **cookie-parser**, **CORS** allow-list.
- **nodemailer** for **OTP** email verification (`otp.model.js`, `config/mailer.js`).
- **Cloudinary** + **multer** for uploading interview videos and files.
- **pdf-parse / pdf-lib** for resume/JD PDF text extraction.
- Has **`@google/generative-ai` (Gemini)** and **`groq-sdk`** installed — Gemini is used in a test file and Groq is the main LLM in the Python services (Node mostly orchestrates + persists).
- Route groups (mounted in `index.js`):
  `/api/user`, `/api/parser`, `/api/jd`, `/api/companies`, `/api/ats`, `/api/interview`, `/api/jobs`.
- Mongo models: `user`, `parser` (ParsedResume), `jd` (JobDescription), `company`, `ats`, `interview`, `interviewcalender`, `otp`.

### 2.3 Python microservices — `models/`
1. **`Interview api_service/`** — the mock-interview brain (`interview_service.py`, Flask):
   - LLM: **Groq `qwen/qwen3.6-27b`** (env `GROQ_MODEL`) — generates the greeting, questions, follow-ups, and the final feedback JSON.
   - STT: **Groq Whisper `whisper-large-v3-turbo`** (`/api/transcribe_audio`).
   - TTS: **Sarvam AI `bulbul:v2`** (`sarvam_service.py`) — gives the interviewer a *voice* (also supports Indian languages, STT `saarika:v2`, translate `mayura:v1`).
   - **Sessions are stored in JSON files** on disk (`data/interview_sessions.json`), *not* in Mongo. Mongo only gets the final saved record.
2. **`Resume ATS and JD/api_service/`** — ATS scorer (`main.py`, Flask):
   - **SentenceTransformers `all-MiniLM-L6-v2`** embeddings + **ChromaDB** persistent vector DB (`resume_db`).
   - `compute_local_score` = cosine similarity(resume, JD) scaled to 0–99.
   - `get_best_resumes_for_JD` = vector search over a collection of **placed/successful resumes** (`build_database.py` ingests a folder of PDFs) to show the top-3 most similar winning resumes.
   - Groq LLM produces the structured ATS report (JD match %, missing keywords, skills match, improvement tips).
3. **`Audio_Emotion_Analysis/`** — Speech Emotion Recognition REST API (Flask):
   - Pre-trained **Keras `.h5` CNN models** on **MFCC / mel-spectrogram** features.
   - Predicts emotion (3/6/7 classes) + gender + confidence; used to give "Voice Emotion Analysis" in feedback.

---

## 3. End-to-end flow of ONE mock interview (know this cold)

1. **Configure** in `Simulations.tsx`; navigate to `Interview.tsx` carrying `{company, role, jobDescription, level, duration, interviewType, resume}` via router state.
2. `Interview.tsx` requests **camera+mic** (`getUserMedia`), shows the candidate's own video feed.
3. **Start** → `POST {VITE_INTERVIEW_API}/api/start_interview`. Python builds a **system prompt** from role + resume + JD + type + level + duration, creates a `session_id`, returns state `waiting_intro`. (Number of questions is derived from duration: 5min→3 … 45min→17.)
4. Candidate **records intro** → `POST /api/transcribe_audio` (Groq Whisper) returns text; **in parallel** `POST {VITE_EMOTION_API}/predict` runs voice-emotion analysis. Text is placed in the input box for review.
5. **Send** → `POST /api/submit_intro` (then `/api/submit_answer` for each answer). Python calls **Groq Llama** with the running conversation history to produce the next question/follow-up (temperature 0.4, ≤350 tokens, "one question, 3–4 sentences"). It then calls **Sarvam TTS** → saves a `.wav` → returns `audio_url`; the browser **plays the interviewer's voice**.
6. After `max_questions` answered, Python sends a warm closing and sets state `completed`.
7. Frontend auto-calls `GET /api/get_feedback/{session_id}` → Groq returns **JSON feedback**: `overall_rating` + 4 sub-scores (`technical_accuracy`, `communication`, `depth`, `problem_solving`) + summary, strengths, areas_for_improvement, next_steps.
8. Frontend then `POST {VITE_API_BASE_URL}/interview/save` → **Node persists the full transcript + feedback into MongoDB** (`Interview` collection). That Mongo data powers the **Performance/analytics dashboard** (recharts).

**Interview types** (drive the prompt): `hr`, `technical_projects`, `technical_role`, `dsa`, `hybrid`.
**Levels:** easy / medium / hard. These change *the prompt instructions*, i.e. "adaptive difficulty."

---

## 4. ⚠️ Resume vs. reality — READ THIS BEFORE ANY INTERVIEW

Your resume bullet says:
> "React, Node.js, Express, MongoDB, **LangChain, Pinecone, OpenAI API** … RAG pipeline using
> **LangChain and Pinecone**, **~85% retrieval accuracy** across **500+ domain-specific Q&A
> pairs** for context-aware mock question generation … **OpenAI's GPT model** for adaptive
> difficulty…"

Here is what the code actually shows. **An interviewer who probes will find these gaps, so you must be ready.**

| Resume claim | Reality in the code | Verdict |
|---|---|---|
| React, Node, Express, MongoDB | Yes — React 19, Express 5, Mongoose | ✅ True |
| **LangChain** | No `langchain` import anywhere | ❌ Not used |
| **Pinecone** | Uses **ChromaDB** (a different vector DB) | ❌ Wrong tool named |
| **OpenAI GPT API** | Uses **Groq (Llama-3.3-70B)**, **Google Gemini**, **Groq Whisper**, **Sarvam TTS** | ❌ Not used |
| **RAG over 500+ Q&A pairs for question generation** | Questions are **prompt-generated** by stuffing resume+JD into a Groq system prompt. The only vector retrieval (ChromaDB + embeddings) is for **resume↔JD / "similar placed resume" matching** in the *ATS* feature — not for question generation, and there is no 500-pair Q&A knowledge base | ⚠️ Misleading / not implemented as described |
| **~85% retrieval accuracy** | No evaluation harness computing retrieval accuracy exists | ⚠️ Unsubstantiated number |
| Session storage & analytics in MongoDB | Final sessions + feedback *are* saved to Mongo and drive the dashboard (live sessions transit through JSON files first) | ✅ Mostly true |
| Adaptive difficulty + follow-up questions | Real — level/type change the prompt; follow-ups come from conversation history | ✅ True (via prompting, not "GPT fine-tuning") |

### What you should do about it (pick one, before placements ramp up)
- **Option A — Align the resume to the truth (safest, fastest).** Rewrite the bullet to describe
  what you built: *"Groq Llama-3.3-70B for adaptive question generation, Whisper for speech-to-text,
  Sarvam for text-to-speech, SentenceTransformers + ChromaDB for semantic resume↔JD matching, plus a
  Keras speech-emotion model."* This is honestly **more impressive and more unusual** than "LangChain + Pinecone + OpenAI."
- **Option B — Make the resume true.** Actually implement a LangChain + Pinecone RAG over a real
  Q&A dataset for question generation, and swap in OpenAI. More work; only if you have time.
- **Do NOT** walk into an interview with the current mismatch unaddressed. If asked "show me the
  Pinecone/LangChain code," you need an answer. The strongest answer is Option A + an honest
  "I initially prototyped with X and moved to Groq/Chroma for latency and cost — here's why."

---

## 5. Likely interview questions (with answer directions)

**Architecture & design**
- *Why microservices instead of one Node app?* → ML/LLM work (Whisper, embeddings, Keras) lives
  naturally in Python; separating the Flask AI services from the Node CRUD/auth API lets each scale
  and deploy independently, and keeps heavy model memory out of the request-serving API.
- *Why does the frontend call the Python interview service directly instead of proxying through Node?*
  → Lower latency for the real-time voice loop and simpler streaming of audio; Node still owns auth
  and persistence. (Honest trade-off: it also means auth isn't enforced on the interview service —
  a real weakness you can name if asked about security.)
- *Where does interview state live?* → In-progress session in JSON files inside the Python service
  (`interview_sessions.json`); the finished transcript+feedback is persisted to MongoDB via Node.

**AI / LLM**
- *How do you generate context-aware questions?* → A system prompt templated with role, resume, JD,
  interview type and level; each turn re-sends the conversation history so Groq Llama asks a relevant
  follow-up. Temperature 0.4, capped at 350 tokens, "one question at a time."
- *How is "adaptive difficulty" implemented?* → Level (easy/medium/hard) and interview type inject
  different instruction blocks into the prompt (e.g. DSA vs HR vs project-based).
- *How does scoring/feedback work?* → After the last question, Groq is asked to return **strict JSON**
  scoring 4 dimensions 1–10 plus qualitative feedback; the code slices the JSON out and stores it.
- *What is the RAG part?* → **Be precise:** the ATS feature embeds resume and JD with
  `all-MiniLM-L6-v2` and uses **ChromaDB** to (a) score similarity and (b) retrieve the most similar
  *successful* resumes. Do **not** claim the mock-question generator is RAG.
- *Why Groq?* → Very low-latency inference (you literally have a commit "fixed the Groq latency
  issues"), cheaper than GPT-4-class for this volume, and Whisper STT in the same SDK.

**Voice pipeline**
- *Full voice loop?* → Browser MediaRecorder → webm blob → Groq Whisper STT → text →
  Groq Llama question → Sarvam `bulbul:v2` TTS → `.wav` served back → browser plays it. Emotion model
  runs on the same audio blob in parallel.

**Data / backend**
- *Auth?* → JWT in httpOnly cookie + bcrypt password hashing + email OTP verification via nodemailer.
- *Interview schema?* → `Interview` model: userId, type, role/company/level/duration, optional jdId +
  resumeId refs, Cloudinary video URL, `transcript: [{question, answer}]`, and an embedded `feedback`
  object (overall_rating + 4 scores + strengths/areas/next_steps).
- *Analytics?* → Dashboard reads the user's saved `Interview` docs and charts score trends per
  dimension/type with recharts.

**Weaknesses to be honest about (interviewers love this)**
- No auth on the Python interview/emotion services (frontend hits them directly).
- Live session state in flat JSON files = not concurrency-safe / not horizontally scalable.
- The "85% retrieval accuracy / 500+ Q&A pairs / LangChain / Pinecone / OpenAI" claims aren't in the code.
- `.env` secrets, `resume_db`, and temp uploads need proper handling in prod.

---

## 6. Fast revision checklist
- [ ] I can draw the 5-service diagram from memory.
- [ ] I can narrate the one-interview flow (start → STT → LLM → TTS → feedback → save).
- [ ] I can name the *real* tech: Groq Llama-3.3-70B, Whisper, Sarvam TTS, SentenceTransformers, ChromaDB, Keras SER.
- [ ] I have a clear, honest story for the LangChain/Pinecone/OpenAI resume mismatch.
- [ ] I can explain adaptive difficulty = prompt engineering, and feedback = JSON-mode LLM scoring.
- [ ] I can list 3 real weaknesses and how I'd fix them.

---
*Generated from a full read of the codebase on 2026-07-01. Files to reread before an interview:
`models/Interview api_service/interview_service.py`, `frontend/src/pages/Interview.tsx`,
`models/Resume ATS and JD/api_service/main.py`, `backend/src/models/interview.model.js`.*
