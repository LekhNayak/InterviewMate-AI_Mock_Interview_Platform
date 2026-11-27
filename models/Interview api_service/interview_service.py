import base64
import json
import os
import re
import uuid
from datetime import datetime
from pathlib import Path
from typing import Dict, Literal, Optional, Tuple

from dotenv import load_dotenv
from flask import Flask, g, has_request_context, jsonify, request
from flask_cors import CORS
from werkzeug.exceptions import RequestEntityTooLarge

from sarvam_service import text_to_speech
from groq_keys import call_groq
from service_auth import install_auth
from session_store import find_session, insert_session, save_session

SERVICE_ROOT = Path(__file__).resolve().parent

load_dotenv(SERVICE_ROOT / ".env")

# Vercel caps request and response bodies at 4.5 MB.
MAX_UPLOAD_BYTES = 4 * 1024 * 1024
# Base64 adds a third, so 3 MB of WAV (about 95 s at 16 kHz) is the most one reply can carry.
MAX_AUDIO_BYTES = 3 * 1024 * 1024

FEEDBACK_MAX_TOKENS = 1200
FEEDBACK_ATTEMPTS = 2

ALLOWED_AUDIO_EXT = {".mp3", ".wav", ".webm", ".m4a", ".ogg", ".flac"}


def create_app() -> Flask:
    app = Flask(__name__)
    app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_BYTES

    CORS(app)
    install_auth(app, public_paths=("/api/health",))

    @app.errorhandler(413)
    def too_large(_err):
        return jsonify({"error": "The recording is too long. Keep each answer under about 3 minutes."}), 413

    @app.route("/api/health", methods=["GET"])
    def health():
        return jsonify({"status": "ok"})

    @app.route("/api/start_interview", methods=["POST"])
    def start_interview():
        payload = request.get_json(force=True)

        role = (payload.get("role") or "").strip()
        resume = payload.get("resume")
        jd = (payload.get("jd") or "").strip()
        level = (payload.get("interview_level") or "medium").strip().lower()
        duration = (payload.get("interview_duration") or "15min").strip()
        interview_type = (payload.get("interview_type") or "technical_role").strip().lower()

        if not role or not resume or not jd:
            return jsonify({"error": "role, resume, and jd are required"}), 400
        if level not in {"easy", "medium", "hard"}:
            return jsonify({"error": "interview_level must be easy|medium|hard"}), 400

        session_id = _create_session(role, resume, jd, level, duration, interview_type)
        print("Session ID:", session_id)

        return jsonify({"session_id": session_id, "status": "waiting_intro"}), 200


    @app.route("/api/submit_intro", methods=["POST"])
    def submit_intro():
        try:
            session_id, intro_text = _resolve_input_text(stage="intro")
            result = _handle_intro(session_id, intro_text)
            return jsonify(result), 200
        except ValueError as err:
            return jsonify({"error": str(err)}), 400
        except RequestEntityTooLarge:
            raise
        except Exception as exc:
            return jsonify({"error": str(exc)}), 500

    @app.route("/api/submit_answer", methods=["POST"])
    def submit_answer():
        try:
            session_id, answer_text = _resolve_input_text(stage="answer")
            result = _handle_answer(session_id, answer_text)
            return jsonify(result), 200
        except ValueError as err:
            return jsonify({"error": str(err)}), 400
        except RequestEntityTooLarge:
            raise
        except Exception as exc:
            return jsonify({"error": str(exc)}), 500

    @app.route("/api/transcribe_audio", methods=["POST"])
    def transcribe_audio_endpoint():
        try:
            file = request.files.get("audio")
            if not file:
                raise ValueError("No audio file provided")
            transcript = _transcribe_upload(file)
            return jsonify({"transcribed_text": transcript}), 200

        except ValueError as err:
            return jsonify({"error": str(err)}), 400
        except RequestEntityTooLarge:
            raise
        except Exception as exc:
            print("Server error:", exc)
            return jsonify({"error": str(exc)}), 500



    @app.route("/api/get_session/<session_id>", methods=["GET"])
    def get_session(session_id: str):
        try:
            session = _fetch_session(session_id)
            return jsonify(session), 200
        except ValueError as err:
            return jsonify({"error": str(err)}), 404

    @app.route("/api/get_history/<session_id>", methods=["GET"])
    def get_history(session_id: str):
        try:
            session = _fetch_session(session_id)
            return jsonify(
                {
                    "conversation_history": session["conversation_history"],
                    "questions_asked": session["questions_asked"],
                }
            ), 200
        except ValueError as err:
            return jsonify({"error": str(err)}), 404

    @app.route("/api/get_feedback/<session_id>", methods=["GET"])
    def get_feedback(session_id: str):
        try:
            session = _fetch_session(session_id)
        except ValueError as err:
            return jsonify({"error": str(err)}), 404
        if session["current_state"] != "completed":
            return jsonify({"error": "Interview not completed yet"}), 400
        try:
            return jsonify(_ensure_feedback(session)), 200
        except Exception as exc:
            print(f"ERROR: feedback failed for session {session_id}: {exc}")
            return jsonify({"error": "The feedback could not be generated. Try again."}), 502

    return app


# ---------- Internal helpers ----------

def _log(event: Dict) -> None:
    # One JSON line on stdout: Vercel and Docker both keep it in their logs.
    print(json.dumps(dict(event, timestamp=datetime.now().isoformat()), ensure_ascii=False))


def _transcribe_upload(file) -> str:
    """Transcribe an uploaded audio file in memory. Nothing is written to disk."""
    filename = Path(file.filename or "").name
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED_AUDIO_EXT:
        raise ValueError(f"Unsupported audio format. Allowed: {', '.join(sorted(ALLOWED_AUDIO_EXT))}")

    audio = file.read()
    transcription = call_groq(
        lambda client: client.audio.transcriptions.create(
            file=(filename, audio),
            model="whisper-large-v3-turbo",
            response_format="text",
        ),
        timeout=120.0,
    )
    transcript = transcription.strip() if isinstance(transcription, str) else (transcription.text or "").strip()
    if not transcript:
        raise RuntimeError("Transcription returned empty result")
    return transcript


_DURATION_TO_QUESTIONS = {
    "5min": 3,
    "10min": 5,
    "15min": 8,
    "30min": 12,
    "45min": 17,
}

# A reply that says goodbye without asking anything ends the interview early.
# Polite phrases such as "thank you" are not enough: they also open normal questions.
_CLOSING_PHRASES = (
    "that's a wrap",
    "that\u2019s a wrap",
    "best of luck",
    "pleasure speaking",
    "thank you for your time",
    "concludes our interview",
    "concludes the interview",
    "end of our interview",
    "end of the interview",
)


def _is_closing(response: str) -> bool:
    text = response.lower()
    return "?" not in text and any(phrase in text for phrase in _CLOSING_PHRASES)


_INTERVIEW_TYPE_INSTRUCTIONS = {
    "hr": (
        "HR Interview",
        "Focus exclusively on behavioral and cultural-fit questions. Ask about teamwork, conflict resolution, "
        "strengths/weaknesses, motivation, career goals, and past experiences using the STAR method. "
        "Do NOT ask technical or coding questions."
    ),
    "technical_projects": (
        "Technical Interview (Projects Based)",
        "Focus on the candidate's projects listed in their resume. Ask about architecture decisions, tech stack choices, "
        "challenges faced, how they solved problems, and what they would do differently. "
        "Probe depth of ownership and understanding. Do NOT ask generic DSA questions."
    ),
    "technical_role": (
        "Technical Interview (Role Based)",
        "Focus on role-specific technical knowledge based on the JD. Ask about frameworks, tools, design patterns, "
        "system design concepts, and domain knowledge relevant to the role. "
        "Reference the JD's required skills throughout."
    ),
    "dsa": (
        "DSA Interview",
        "Focus entirely on data structures and algorithms. Ask about arrays, strings, trees, graphs, dynamic programming, "
        "sorting, searching, and complexity analysis. Present conceptual problems and ask the candidate to walk through "
        "their approach, time/space complexity, and edge cases. Do NOT ask HR or project questions."
    ),
    "hybrid": (
        "Hybrid Interview (DSA + Technical)",
        "Split the interview equally: half DSA questions (data structures, algorithms, complexity) and half "
        "role-specific technical questions (frameworks, design, domain knowledge from the JD). "
        "Alternate between both categories."
    ),
}


def _max_questions(duration: str) -> int:
    return _DURATION_TO_QUESTIONS.get(duration, 8)


def _system_prompt(role: str, resume: str, jd: str,
                   level: Literal["easy", "medium", "hard"],
                   duration: str, interview_type: str) -> str:
    type_label, type_instructions = _INTERVIEW_TYPE_INSTRUCTIONS.get(
        interview_type, _INTERVIEW_TYPE_INSTRUCTIONS["technical_role"]
    )
    max_q = _max_questions(duration)

    return f"""
You are an expert interviewer conducting a {type_label} for the role: {role}

[CANDIDATE RESUME]
{resume}

[JOB DESCRIPTION]
{jd}

[INTERVIEW PARAMETERS]
- Type: {type_label}
- Level: {level.upper()}
- Duration: {duration}
- Max Questions: {max_q}

[INTERVIEW STYLE]
{type_instructions}

[RULES]
- Give a warm welcome after the candidate's introduction, then ask the first question.
- Ask a maximum of {max_q} questions total. Keep track internally.
- After the {max_q}th question is answered, wrap up warmly: thank the candidate, give a brief encouraging closing remark, and end the interview. Do NOT ask another question.
- Adjust question depth to difficulty level: {level}.
- Probe when answers are vague; move on when satisfied.
- Keep each response focused — one question at a time.
- IMPORTANT: Keep every response to 3–4 sentences maximum. One sentence acknowledging the candidate's answer (brief, genuine), then ask a specific, in-depth follow-up or next question. No lengthy preambles or excessive praise.

Wait for the candidate's introduction before asking any questions.
""".strip()


def _create_session(role: str, resume: str, jd: str,
                    level: Literal["easy", "medium", "hard"],
                    duration: str, interview_type: str = "technical_role") -> str:
    session_id = str(uuid.uuid4())
    session = {
        "session_id": session_id,
        "user_id": g.get("user_id") if has_request_context() else None,
        "role": role,
        "resume_text": resume,
        "jd_text": jd,
        "interview_level": level,
        "interview_duration": duration,
        "interview_type": interview_type,
        "max_questions": _max_questions(duration),
        "system_prompt": _system_prompt(role, resume, jd, level, duration, interview_type),
        "conversation_history": [],
        "questions_asked": [],
        "current_state": "waiting_intro",
        "intro_received": False,
        "start_time": datetime.now().isoformat(),
    }
    insert_session(session)

    _log({
        "event": "session_started",
        "session_id": session_id,
        "role": role,
        "level": level,
        "duration": duration,
        "interview_type": interview_type,
    })
    return session_id


def _fetch_session(session_id: str) -> Dict:
    session = find_session(session_id)
    if session:
        owner = session.get("user_id")
        # Someone else's session looks the same as a missing one.
        if not (owner and has_request_context() and g.get("user_id") != owner):
            return session
    raise ValueError(f"Session {session_id} not found")


def _save_session(session: Dict) -> None:
    save_session(session)


def _log_flow(session_id: str, action: str, questions_count: Optional[int] = None) -> None:
    entry = {"event": "flow", "session_id": session_id, "action": action}
    if questions_count is not None:
        entry["questions_count"] = questions_count
    _log(entry)


def _strip_reasoning(text: str) -> str:
    """Remove <think>...</think> blocks some reasoning models emit.

    Safety net for the interview flow: this text is spoken to the candidate and
    is also fed to json.loads() in _generate_feedback, so stray reasoning would
    both leak into the interview and break the feedback parse.
    """
    cleaned = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL)
    # An unterminated block (response cut off mid-reasoning) leaves a dangling tag.
    cleaned = re.sub(r"<think>.*", "", cleaned, flags=re.DOTALL)
    return cleaned.strip()


def _groq_response(system: str, user: str, max_tokens: int = 350) -> str:
    model_name = os.getenv("GROQ_MODEL", "qwen/qwen3.8-27b")

    kwargs = {}
    # Qwen3 emits <think> reasoning by default. reasoning_effort="none" turns it
    # off at the source; models that are not reasoning models reject the value,
    # so only send it for Qwen.
    if "qwen" in model_name.lower():
        kwargs["reasoning_effort"] = "none"

    response = call_groq(lambda client: client.chat.completions.create(
        model=model_name,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        temperature=0.4,
        max_tokens=max_tokens,
        **kwargs,
    ))
    return _strip_reasoning(response.choices[0].message.content)


def _generate_intro_response(session: Dict, intro_text: str) -> str:
    user = (
        f"Candidate introduction:\n{intro_text}\n\n"
        "Greet the candidate warmly and naturally — like a real interviewer would. "
        "Say hello, briefly acknowledge something specific from their intro (name, background, or experience), "
        "then transition smoothly into the first interview question. Keep it friendly but professional."
    )
    return _groq_response(session["system_prompt"], user)


def _generate_followup(session: Dict, new_answer: str) -> str:
    history = "\n".join(
        f"[{msg['role'].upper()}] {msg['content']}"
        for msg in session["conversation_history"]
    )
    user = f"Conversation so far:\n{history}\n[CANDIDATE] {new_answer}\n\nGive the next question or wrap-up, following the guidelines."
    return _groq_response(session["system_prompt"], user)


def _ensure_feedback(session: Dict) -> Dict:
    """Return the feedback stored on the session, generating it on first use."""
    if session.get("feedback_record"):
        return session["feedback_record"]
    record = _generate_feedback(session)
    session["feedback_record"] = record
    _save_session(session)
    return record


def _parse_json_object(text: str) -> Dict:
    start, end = text.find("{"), text.rfind("}") + 1
    if start == -1 or end <= start:
        raise ValueError("no JSON object in the model reply")
    return json.loads(text[start:end])


def _request_feedback(system: str, user: str) -> Dict:
    last_error: Optional[Exception] = None
    for _ in range(FEEDBACK_ATTEMPTS):
        try:
            return _parse_json_object(_groq_response(system, user, max_tokens=FEEDBACK_MAX_TOKENS))
        except ValueError as err:  # includes json.JSONDecodeError
            last_error = err
    raise RuntimeError(f"Feedback was not valid JSON: {last_error}")


def _generate_feedback(session: Dict) -> Dict:
    conversation = "\n".join(
        f"[{msg['role'].upper()}] {msg['content']}" for msg in session["conversation_history"]
    )
    system = "You are an expert interview coach. Always respond with valid JSON only — no markdown, no explanation."
    user = f"""Role: {session['role']}
Level: {session['interview_level']}
Interview Type: {session.get('interview_type', 'technical_role')}
Duration: {session['interview_duration']}

Conversation:
{conversation}

Score the candidate on each dimension from 1–10 based strictly on their actual answers above.
Be objective — do not inflate scores. A score of 7+ means genuinely strong performance.

Respond with ONLY valid JSON:
{{
  "overall_rating": <integer 1-10>,
  "scores": {{
    "technical_accuracy": <integer 1-10>,
    "communication": <integer 1-10>,
    "depth": <integer 1-10>,
    "problem_solving": <integer 1-10>
  }},
  "summary": "2-3 sentence overall assessment of the candidate",
  "strengths": ["specific strength 1", "specific strength 2"],
  "areas_for_improvement": ["specific area 1", "specific area 2"],
  "recommended_next_steps": ["actionable step 1", "actionable step 2"]
}}

Scoring guide:
- technical_accuracy: Correctness of technical facts, concepts, and solutions given
- communication: Clarity, structure, and confidence in how answers were delivered
- depth: How detailed and thorough the answers were — did they go beyond surface level?
- problem_solving: Logical thinking, structured approach, handling of edge cases
- overall_rating: Holistic score weighing all four dimensions at {session['interview_level']} difficulty"""
    feedback = _request_feedback(system, user)

    # Ensure overall_rating is always an integer string for frontend compat
    scores = feedback.get("scores", {})
    if scores and not feedback.get("overall_rating"):
        vals = [v for v in scores.values() if isinstance(v, (int, float))]
        feedback["overall_rating"] = str(round(sum(vals) / len(vals))) if vals else "0"
    else:
        feedback["overall_rating"] = str(feedback.get("overall_rating", "0"))

    return {
        "session_id": session["session_id"],
        "feedback": feedback,
        "role": session["role"],
        "timestamp": datetime.now().isoformat(),
    }


def _resolve_input_text(stage: str, require_session: bool = True) -> Tuple[str, str]:
    """
    Accepts either:
    - JSON body with text/plain text
    - Multipart/form-data with 'audio' file
    """
    session_id = request.form.get("session_id") or request.args.get("session_id")
    json_payload = request.get_json(silent=True) or {}
    session_id = session_id or json_payload.get("session_id")

    if require_session and not session_id:
        raise ValueError("session_id is required")
    if require_session:
        _fetch_session(session_id)  # ensure exists

    text_value = None
    if isinstance(json_payload, dict):
        text_value = (json_payload.get("text") or "").strip()
    if text_value:
        return session_id, text_value

    file = request.files.get("audio")
    if not file:
        raise ValueError("Provide either 'text' or 'audio' in the request")

    return session_id, _transcribe_upload(file)


def _handle_intro(session_id: str, intro_text: str) -> Dict:
    session = _fetch_session(session_id)
    if session["intro_received"]:
        raise ValueError("Introduction already submitted")

    response = _generate_intro_response(session, intro_text)
    _record_message(session, "candidate", intro_text, "intro")
    _record_message(session, "interviewer", response, "question")
    session["intro_received"] = True
    session["current_state"] = "in_interview"
    _save_session(session)
    _log_flow(session_id, "intro_submitted")

    audio_url = _synthesize_audio(session_id, response)
    return {
        "session_id": session_id,
        "response": response,
        "state": "in_interview",
        "audio_url": audio_url,
    }


def _handle_answer(session_id: str, answer_text: str) -> Dict:
    session = _fetch_session(session_id)
    if not session["intro_received"]:
        raise ValueError("Please submit introduction first")
    if session["current_state"] == "completed":
        raise ValueError("This interview is already completed")

    questions_before = len(session["questions_asked"])
    max_q = session.get("max_questions", _max_questions(session.get("interview_duration", "15min")))

    # questions_before >= max_q means all questions have been asked AND answered —
    # send a warm closing instead of generating another question.
    # questions_before < max_q means the user just answered an intermediate question —
    # ask the next one, even if it will be the last (user must be able to answer it).
    if questions_before >= max_q:
        response = (
            "That's a wrap! You did a fantastic job today — your answers were thoughtful and showed real depth. "
            "I really enjoyed our conversation. "
            "Your feedback is on its way. Click the 'View Feedback' button when it appears to see your "
            "strengths, areas to improve, and personalised next steps. Best of luck!"
        )
        is_done = True
    else:
        response = _generate_followup(session, answer_text)
        # Let the AI end early if it naturally wraps up (edge case)
        is_done = _is_closing(response)

    _record_message(session, "candidate", answer_text, "answer")
    _record_message(session, "interviewer", response, "question")
    _save_session(session)

    questions_after = len(session["questions_asked"])

    if is_done:
        session["current_state"] = "completed"
        session["end_time"] = datetime.now().isoformat()
        _save_session(session)
        _log_flow(session_id, "end_interview", questions_after)
        try:
            _ensure_feedback(session)
        except Exception as exc:
            # The closing message must still reach the candidate; get_feedback retries.
            print(f"ERROR: feedback failed for session {session_id}: {exc}")
        state = "completed"
        action = "end_interview"
    else:
        _log_flow(session_id, "new_question", questions_after)
        state = session["current_state"]
        action = "new_question"

    audio_url = _synthesize_audio(session_id, response)
    return {
        "session_id": session_id,
        "response": response,
        "state": state,
        "action": action,
        "questions_count": questions_after,
        "audio_url": audio_url,
    }


def _record_message(session: Dict, role: str, content: str, msg_type: str) -> None:
    session["conversation_history"].append(
        {"role": role, "content": content, "type": msg_type}
    )
    if role == "interviewer" and msg_type == "question":
        session["questions_asked"].append(content)


def _synthesize_audio(session_id: str, text: str) -> Optional[str]:
    """Speak the reply and return it as a data: URL the browser can play directly.

    The audio travels inside the JSON response instead of as a file to fetch later,
    because a later request may reach an instance that never had the file.
    """
    try:
        audio_bytes = text_to_speech(text)
        if len(audio_bytes) > MAX_AUDIO_BYTES:
            # Too big for one Vercel response once base64-encoded; the text still shows.
            print(f"WARNING: skipped {len(audio_bytes)} bytes of audio for session {session_id}")
            return None
        return "data:audio/wav;base64," + base64.b64encode(audio_bytes).decode("ascii")
    except Exception as e:
        print(f"ERROR: Sarvam TTS failed for session {session_id} and text starting with '{text[:50]}...'. Error: {e}")
        return None

if __name__ == "__main__":
    app = create_app()
    
    # NOTE: The explicit CORS line for 'http://localhost:8080' has been removed
    # because CORS(app) in create_app() now correctly enables it globally for dev.

    app.run(
        host="0.0.0.0",
        port=int(os.getenv("PORT", "5000")),
        # The debugger can run code for anyone who reaches the port, so it is opt-in.
        debug=os.getenv("FLASK_DEBUG") == "1",
    )