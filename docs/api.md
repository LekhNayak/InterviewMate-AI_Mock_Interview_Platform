# API reference

Local base URLs:

| Service | Base URL |
|---|---|
| Express API | `http://localhost:8000/api` |
| Interview service | `http://localhost:5000/api` |
| ATS service | `http://localhost:6050/api` |
| Emotion service | `http://localhost:8090/api` |

In the Express tables, **Login** means the `token` cookie is required. Browser calls must send `credentials: "include"`. Without a valid cookie the answer is 401.

## Users

| Method | Path | Login | Purpose |
|---|---|---|---|
| POST | `/user/signup/request-otp` | No | Email a six-digit code. Body: `email`. |
| POST | `/user/signup/complete` | No | Create the account and set the cookie. Body: `name`, `email`, `password`, `otp`. |
| POST | `/user/login` | No | Set the cookie. Body: `email`, `password`. |
| GET | `/user/profile` | Yes | Current user |
| PUT | `/user/update` | Yes | Update name, age, gender, skills, interests and profile URLs |
| PUT | `/user/logout` | Yes | Clear the cookie. The app's **Log Out** button does not call this. |
| PATCH | `/user/change-password` | Yes | Body: `currentPassword`, `newPassword` |
| DELETE | `/user/delete` | Yes | Always answers 404, because the route has no id |

## Resumes

| Method | Path | Login | Purpose |
|---|---|---|---|
| POST | `/parser/parse` | Yes | Upload a PDF in the `file` field, parse it and save it. Optional `title`. |
| GET | `/parser/all` | Yes | Your resumes |
| POST | `/parser/create` | Yes | Create a resume. The owner is taken from the cookie. |
| PUT | `/parser/update/:id` | Yes | Update your resume |
| DELETE | `/parser/delete/:id` | Yes | Delete your resume |

## Job descriptions

| Method | Path | Login | Purpose |
|---|---|---|---|
| POST | `/jd/parse` | Yes | Upload a PDF in the `jd` field, parse it and save it. Optional `isPublic`. |
| GET | `/jd/` | Yes | Public job descriptions and your own |
| GET | `/jd/user` | Yes | Your own |
| GET | `/jd/get-as-string/:id` | Yes | Plain text version, if public or yours |
| DELETE | `/jd/:id` | Yes | Delete your own |

## ATS

| Method | Path | Login | Purpose |
|---|---|---|---|
| POST | `/ats/analyze` | Yes | Body: `resumeId`, `jdId` |
| POST | `/ats/quick-analyze` | Yes | Body: `resumeId`, `jobRole` |
| GET | `/ats/user` | Yes | Your results |
| GET | `/ats/:id` | Yes | One result |
| GET | `/ats/resume/:resumeId` | Yes | Results for a resume |
| GET | `/ats/jd/:jdId` | Yes | Results for a job description |

## Interviews

| Method | Path | Login | Purpose |
|---|---|---|---|
| POST | `/interview/save` | Yes | Save a finished interview. Used by the app. |
| GET | `/interview/user` | Yes | Your interviews |
| GET | `/interview/type/:type` | Yes | Your interviews of a type |
| GET | `/interview/resume/:resumeId` | Yes | Your interviews for a resume |
| GET | `/interview/jd/:jdId` | Yes | Your interviews for a job description |
| POST | `/interview/create` | Yes | Upload a `videoFile` to Cloudinary and save an interview. Not used by the app. |

## Jobs

| Method | Path | Login | Purpose |
|---|---|---|---|
| POST | `/jobs/search` | Yes | Body: `role`, optional `location`, optional `apiPage` (default 1) |

## Other

| Method | Path | Login | Purpose |
|---|---|---|---|
| GET | `/companies` | No | List companies. Not used by the app. |
| POST | `/companies` | No | Add a company. Not used by the app. |
| GET | `/health` (at the root, not under `/api`) | No | Server and database state |

## Interview service

No login. JSON bodies unless noted.

| Method | Path | Purpose |
|---|---|---|
| POST | `/start_interview` | Create a session |
| POST | `/submit_intro` | Send the introduction, get the first question |
| POST | `/submit_answer` | Send an answer, get the next question or the closing message |
| POST | `/transcribe_audio` | Multipart `audio`. Returns `transcribed_text`. |
| GET | `/get_session/<session_id>` | Full session, including the resume text |
| GET | `/get_history/<session_id>` | Conversation and questions |
| GET | `/get_feedback/<session_id>` | Feedback. 400 until the interview is completed. |
| GET | `/static/recordings/<filename>` | Interviewer audio (WAV) |

`start_interview` requires `role`, `resume` and `jd`. Optional fields:

| Field | Values | Default |
|---|---|---|
| `interview_level` | `easy`, `medium`, `hard` | `medium` |
| `interview_duration` | `5min`, `10min`, `15min`, `30min`, `45min` | `15min` |
| `interview_type` | `hr`, `technical_projects`, `technical_role`, `dsa`, `hybrid` | `technical_role` |

It returns `session_id` and `status: "waiting_intro"`.

`submit_intro` and `submit_answer` take `session_id` and `text`, or a multipart form with `session_id` and `audio`. Audio can be mp3, wav, webm, m4a, ogg or flac, up to 50 MB. A reply to an answer looks like this:

```json
{
  "session_id": "uuid",
  "response": "Next question or closing message",
  "state": "in_interview",
  "action": "new_question",
  "questions_count": 3,
  "audio_url": "/api/static/recordings/api_xxxxxxxx.wav"
}
```

When the interview ends, `state` is `completed` and `action` is `end_interview`. `audio_url` is `null` if speech fails. The reply to `submit_intro` has no `action` or `questions_count`.

`get_feedback` returns `session_id`, `role`, `timestamp` and a `feedback` object with `overall_rating`, `scores`, `summary`, `strengths`, `areas_for_improvement` and `recommended_next_steps`.

## ATS service

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Status |
| GET | `/debug/db` | Index path and document count |
| POST | `/analyze` | Score a resume against a job description |

`/analyze` takes a multipart form with `jd_text` and either a PDF `file` or a `resume_url`, or JSON with `jd_text` and `resume_url`. It returns `resume_filename`, `local_ATS_score`, `Gemini_JSON` and `BestResumesForJD`. The name `Gemini_JSON` is historical. The report comes from Groq.

```bash
curl -X POST http://localhost:6050/api/analyze -F "jd_text=Python backend engineer" -F "file=@resume.pdf"
```

In Windows PowerShell use `curl.exe` instead of `curl`.

## Emotion service endpoints

See [Emotion service](emotion-service.md#endpoints).
