"""Coaching text written from the computed results, so it agrees with the score."""
from typing import Dict, List

from .llm import complete_json
from .text import contains_quote, fold

RESUME_CHARS = 9000

SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["summary", "strengths", "gaps", "suggestions", "bullet_rewrites", "projects_analysis", "verdict"],
    "properties": {
        "summary": {"type": "string"},
        "strengths": {"type": "array", "items": {"type": "string"}},
        "gaps": {"type": "array", "items": {"type": "string"}},
        "suggestions": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["title", "detail", "impact"],
                "properties": {
                    "title": {"type": "string"},
                    "detail": {"type": "string"},
                    "impact": {"type": "string"},
                },
            },
        },
        "bullet_rewrites": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["original", "improved", "why"],
                "properties": {"original": {"type": "string"}, "improved": {"type": "string"}, "why": {"type": "string"}},
            },
        },
        "projects_analysis": {"type": "string"},
        "verdict": {"type": "string"},
    },
}

SYSTEM = ("You are a senior career coach and recruiter. You write specific, honest, practical feedback on a resume "
          "for a target job, in plain English, speaking to the candidate as 'you'. Answer with JSON only.")

RULES = """Write feedback for the candidate using the ANALYSIS below, which is final: do not contradict its score or
its met, partial and missing judgements.

- summary: 2 to 3 sentences on who the candidate is and how they fit this job.
- strengths: 3 to 5 specific strengths for this job, naming real content from the resume.
- gaps: 2 to 5 gaps, most important first. Name knockout gaps first when there are any.
- suggestions: 4 to 6 actions, highest impact first. Each has a short title and a 1 to 2 sentence detail.
  Never tell the candidate to add a skill or experience they do not have, and never to rename or relabel one
  tool, skill or credential as another. For a missing requirement, suggest how to
  gain it, or how to surface related experience the resume already shows. For a partial one, say how to make the
  existing evidence explicit. Include format fixes when the ANALYSIS lists failed checks.
- bullet_rewrites: pick the 2 or 3 weakest bullet points or lines in the resume. "original" must be copied verbatim.
  "improved" keeps the same facts, starts with a strong action verb, adds the job's keywords only where the original
  supports them, and uses placeholders like [X%] or [N users] where a number would help. Never invent results.
  "why" is one short sentence.
- projects_analysis: 2 to 3 sentences on how relevant the projects are to this job, or how the candidate's
  portfolio, case studies or notable work would be, for non-project fields. Say so if there are none.
- verdict: one sentence a recruiter would write after screening."""


def _digest(result: Dict) -> str:
    reqs: List[Dict] = result["requirements"]
    lines = [f"Score: {result['score']}/100 ({result['verdict']}), scoring style: {result['style_name']}."]
    job = result["job"]
    lines.append(f"Job: {job['title']} ({job['seniority']}, {job['domain']})"
                 + (f", needs {job['min_years']:g}+ years" if isinstance(job.get("min_years"), (int, float)) else ""))
    lines.append(f"Candidate: {result['candidate']['headline']}, about {result['candidate']['relevant_years']:g} "
                 "relevant years.")
    for status in ("met", "partial", "missing"):
        items = [r for r in reqs if r["status"] == status]
        if items:
            lines.append(f"{status.upper()}: " + "; ".join(
                f"{r['label']} ({r['importance']}{', knockout' if r['knockout'] else ''})"
                + (f" - {r['note']}" if r["note"] else "") for r in items))
    missing_kw = [k["term"] for k in result["keywords"] if not k["found"]][:12]
    if missing_kw:
        lines.append("Missing keywords: " + ", ".join(missing_kw))
    weak = [f"{c['label']}: {c['detail']}" for c in result["checks"] if c["status"] != "pass"]
    if weak:
        lines.append("Format checks not passed: " + " | ".join(weak))
    return "\n".join(lines)


def write(resume_text: str, result: Dict) -> Dict:
    user = (RULES + "\n\nANALYSIS\n<<<\n" + _digest(result) + "\n>>>\n\nRESUME\n<<<\n"
            + resume_text[:RESUME_CHARS] + "\n>>>")
    data = complete_json(SYSTEM, user, "resume_feedback", SCHEMA, max_tokens=2200)

    folded = fold(resume_text)
    rewrites = [
        {k: str(r.get(k, "")).strip() for k in ("original", "improved", "why")}
        for r in data.get("bullet_rewrites") or []
        if r.get("original") and r.get("improved") and contains_quote(folded, r["original"])
    ]
    suggestions = [
        {"title": str(s.get("title", "")).strip(), "detail": str(s.get("detail", "")).strip(),
         "impact": str(s.get("impact", "")).strip().lower() if str(s.get("impact", "")).strip().lower()
                   in ("high", "medium", "low") else "medium"}
        for s in data.get("suggestions") or [] if s.get("title")
    ]
    return {
        "summary": str(data.get("summary", "")).strip(),
        "strengths": [str(s).strip() for s in data.get("strengths") or [] if str(s).strip()][:5],
        "gaps": [str(s).strip() for s in data.get("gaps") or [] if str(s).strip()][:5],
        "suggestions": suggestions[:6],
        "bullet_rewrites": rewrites[:3],
        "projects_analysis": str(data.get("projects_analysis", "")).strip(),
        "verdict": str(data.get("verdict", "")).strip(),
    }
