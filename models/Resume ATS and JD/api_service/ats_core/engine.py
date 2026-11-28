"""One analysis from start to finish: PDF in, scored report out."""
import time
from typing import Dict, Optional

import semantic

from . import insights, requirements
from .checks import format_score, run_checks
from .keywords import keyword_report
from .pdf import read_pdf
from .scoring import score, resolve_style
from .sections import detect_sections

VERSION = 2


def analyze(pdf_bytes: bytes, jd_text: Optional[str] = None, job_role: Optional[str] = None,
            style: Optional[str] = None, weights: Optional[Dict] = None, include_similar: bool = False,
            rubric: Optional[Dict] = None) -> Dict:
    """rubric: one returned by an earlier analysis of the same job. Reusing it keeps
    the requirements, and so the score, the same across analyses of that job."""
    started = time.monotonic()
    doc = read_pdf(pdf_bytes)
    sections = detect_sections(doc.text)

    reused = requirements.usable_rubric(rubric)
    rubric = reused or requirements.extract_rubric(jd_text, job_role)
    judged = requirements.judge(rubric, doc.text)
    reqs = requirements.verify(judged["requirements"], doc.text)
    job, candidate = dict(rubric["job"]), judged["candidate"]
    job_text = jd_text or job_role or ""

    kw = keyword_report(reqs, jd_text or "", doc.text, exclude=[job.get("title", ""), job.get("company", "")])
    checks = run_checks(doc, sections)

    engine = semantic.load()
    semantic_score = engine.similarity_score(doc.text, job_text) if engine and job_text else None

    resolved = resolve_style(style, job.get("seniority", "unspecified"))
    scored = score(reqs, job, candidate, kw["score"], format_score(checks), semantic_score, resolved, weights)

    result = {
        "version": VERSION,
        **scored,
        "mode": "jd" if jd_text else "role",
        "job": job,
        "candidate": candidate,
        "requirements": reqs,
        "keywords": kw["keywords"],
        "checks": checks,
        "resume": {"pages": doc.pages, "words": len(doc.text.split()),
                   "sections": sorted(s for s in sections if s != "header")},
        "semantic": {"available": engine is not None,
                     **({"score": semantic_score} if semantic_score is not None else {})},
        "rubric": rubric,
        "rubric_reused": reused is not None,
    }

    try:
        result["insights"] = insights.write(doc.text, result)
    except Exception as err:
        # The score and evidence stand on their own; the coaching text is extra.
        print(f"WARNING: feedback text failed: {err}")
        result["insights"] = None

    if include_similar and engine:
        result["similar_resumes"] = engine.best_resumes_for_jd(job_text)

    result["elapsed_ms"] = round((time.monotonic() - started) * 1000)
    return result
