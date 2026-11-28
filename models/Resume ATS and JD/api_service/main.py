"""ATS service: scores a resume PDF against a job description or a job role.

The scoring engine is in ats_core/ (see its __init__.py). The optional embedding
engine is in semantic/ and is only used when installed and switched on.
"""
import json
import os
from urllib.parse import unquote, urlparse

import requests
from dotenv import load_dotenv
from flask import Flask, jsonify, request
from flask_cors import CORS
from groq import APIError
from werkzeug.exceptions import BadRequest, RequestEntityTooLarge

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(os.path.dirname(BASE_DIR), ".env"))
load_dotenv(os.path.join(BASE_DIR, ".env"))

import semantic  # noqa: E402
from ats_core.engine import VERSION, analyze  # noqa: E402
from ats_core.llm import AnalysisError, model_name  # noqa: E402
from ats_core.pdf import UnreadableResume  # noqa: E402
from ats_core.scoring import PRESETS  # noqa: E402
from service_auth import install_auth  # noqa: E402

# Vercel caps a request at 4.5 MB.
MAX_UPLOAD_BYTES = 4 * 1024 * 1024
MAX_JD_CHARS = 20000


def fetch_pdf_bytes_from_url(resume_url: str):
    """Download a PDF and return its bytes and a file name. Raises BadRequest."""
    parsed = urlparse(resume_url or "")
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise BadRequest("resume_url must be an http(s) URL")
    try:
        resp = requests.get(resume_url, timeout=20)
    except requests.RequestException as err:
        raise BadRequest(f"Failed to download resume: {err}")
    if resp.status_code != 200:
        raise BadRequest(f"Failed to download resume: HTTP {resp.status_code}")
    if "pdf" not in resp.headers.get("Content-Type", "").lower() and not parsed.path.lower().endswith(".pdf"):
        raise BadRequest("URL does not point to a PDF file")
    if not resp.content:
        raise BadRequest("Downloaded file is empty")
    if len(resp.content) > MAX_UPLOAD_BYTES:
        raise BadRequest("The resume is larger than 4 MB")
    filename = unquote(os.path.basename(parsed.path)) or "resume.pdf"
    return resp.content, filename if filename.lower().endswith(".pdf") else f"{filename}.pdf"


def _field(name: str) -> str:
    body = request.get_json(silent=True) if request.is_json else None
    value = (body or {}).get(name) if body is not None else request.form.get(name)
    return str(value).strip() if value is not None else ""


app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_BYTES + 512 * 1024
CORS(app)
# Only the Express API calls this service. With SERVICE_TOKEN_SECRET set, it must
# send a token signed with the same secret.
install_auth(app, public_paths=("/", "/api/health"))


@app.errorhandler(RequestEntityTooLarge)
def too_large(_err):
    return jsonify({"error": "The resume is larger than 4 MB"}), 413


@app.route("/", methods=["GET"])
def root():
    return jsonify({"service": "InterviewMate ATS", "version": VERSION,
                    "endpoints": {"health": "/api/health", "analyze": "/api/analyze (POST)"}})


@app.route("/api/health", methods=["GET"])
def health():
    engine = semantic.load()
    return jsonify({"status": "ok", "version": VERSION, "model": model_name(),
                    "semantic": engine is not None, "styles": ["auto", *PRESETS]})


@app.route("/api/debug/db", methods=["GET"])
def debug_db():
    engine = semantic.load()
    if engine is None:
        return jsonify({"semantic": False, "detail": "The semantic engine is not installed or ATS_SEMANTIC is off."}), 404
    return jsonify(engine.diagnostics())


@app.route("/api/analyze", methods=["POST"])
def analyze_resume():
    """Form or JSON fields:
    file (PDF upload) or resume_url; jd_text, or job_role when there is no JD;
    optional style (auto, balanced, keyword, skills, experienced, entry);
    optional weights (JSON object of component weights); optional include_similar=true.
    """
    jd_text = _field("jd_text")[:MAX_JD_CHARS]
    job_role = _field("job_role")[:120]
    if not jd_text and not job_role:
        return jsonify({"error": "Give jd_text or job_role"}), 400

    upload = request.files.get("file")
    if upload and upload.filename:
        if not upload.filename.lower().endswith(".pdf"):
            return jsonify({"error": "Only PDF files are supported"}), 400
        pdf_bytes, filename = upload.read(), upload.filename
    elif _field("resume_url"):
        try:
            pdf_bytes, filename = fetch_pdf_bytes_from_url(_field("resume_url"))
        except BadRequest as err:
            return jsonify({"error": err.description}), 400
    else:
        return jsonify({"error": "Provide either a PDF file or resume_url"}), 400

    weights = rubric = None
    try:
        if _field("weights"):
            weights = json.loads(_field("weights"))
        if _field("rubric"):
            rubric = json.loads(_field("rubric"))
    except ValueError:
        return jsonify({"error": "weights and rubric must be JSON objects"}), 400

    try:
        result = analyze(
            pdf_bytes,
            jd_text=jd_text or None,
            job_role=job_role or None,
            style=_field("style") or None,
            weights=weights if isinstance(weights, dict) else None,
            include_similar=_field("include_similar").lower() == "true",
            rubric=rubric if isinstance(rubric, dict) else None,
        )
    except UnreadableResume as err:
        return jsonify({"error": str(err)}), 422
    except AnalysisError as err:
        return jsonify({"error": f"The AI analysis failed: {err} Try again in a minute."}), 502
    except APIError as err:
        print(f"ERROR: Groq request failed: {err}")
        return jsonify({"error": "The AI service is busy or unavailable. Try again in a minute."}), 502

    result["resume_filename"] = filename
    return jsonify(result)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", 6050)), debug=os.getenv("FLASK_DEBUG") == "1")
