"""Combine the evidence into one score. Code computes it; the model never sets it.

Scoring styles weigh the same evidence differently, so one engine fits any job:

  balanced     the default for most roles
  keyword      like classic ATS keyword filters (Taleo, older Workday setups)
  skills       skills-first hiring: what you can do counts most
  experienced  senior roles: years and responsibilities count more
  entry        students and freshers: education counts, years count less

"auto" picks entry for intern and entry-level jobs, experienced for senior,
lead and executive jobs, and balanced otherwise. ATS_WEIGHTS (a JSON object in
the environment) or the request's `weights` can override any weight.
"""
import json
import os
from typing import Dict, List, Optional

COMPONENTS = {
    "required": "Required qualifications",
    "preferred": "Preferred qualifications",
    "experience": "Experience",
    "responsibilities": "Responsibilities",
    "education": "Education and certifications",
    "keywords": "Keyword match",
    "format": "ATS readability",
    "semantic": "Semantic similarity",
}

PRESETS = {
    "balanced":    {"required": 0.32, "preferred": 0.10, "experience": 0.15, "responsibilities": 0.12,
                    "education": 0.06, "keywords": 0.15, "format": 0.10},
    "keyword":     {"required": 0.25, "preferred": 0.08, "experience": 0.10, "responsibilities": 0.05,
                    "education": 0.05, "keywords": 0.37, "format": 0.10},
    "skills":      {"required": 0.42, "preferred": 0.15, "experience": 0.08, "responsibilities": 0.12,
                    "education": 0.03, "keywords": 0.10, "format": 0.10},
    "experienced": {"required": 0.28, "preferred": 0.07, "experience": 0.25, "responsibilities": 0.20,
                    "education": 0.02, "keywords": 0.10, "format": 0.08},
    "entry":       {"required": 0.32, "preferred": 0.10, "experience": 0.05, "responsibilities": 0.10,
                    "education": 0.15, "keywords": 0.16, "format": 0.12},
}
SEMANTIC_WEIGHT = 0.10  # added when the optional embedding engine is installed
STYLE_NAMES = {"balanced": "Balanced", "keyword": "Classic ATS", "skills": "Skills first",
               "experienced": "Experienced hire", "entry": "Entry level"}

CREDIT = {"met": 1.0, "partial": 0.5, "missing": 0.0}
SKILL_CATEGORIES = {"skill", "tool", "knowledge", "language", "soft_skill", "other"}
KNOCKOUT_CAP = 45  # a missing hard gate caps the score: most ATS screen these out


def resolve_style(requested: Optional[str], seniority: str) -> str:
    if requested in PRESETS:
        return requested
    if seniority in ("intern", "entry"):
        return "entry"
    if seniority in ("senior", "lead", "executive"):
        return "experienced"
    return "balanced"


def _weights(style: str, overrides: Optional[Dict], semantic: bool) -> Dict[str, float]:
    weights = dict(PRESETS[style])
    if semantic:
        weights["semantic"] = SEMANTIC_WEIGHT
    for source in (os.getenv("ATS_WEIGHTS"), overrides):
        if not source:
            continue
        try:
            data = json.loads(source) if isinstance(source, str) else source
            for key, value in data.items():
                if key in COMPONENTS and isinstance(value, (int, float)) and value >= 0:
                    weights[key] = float(value)
        except (ValueError, AttributeError):
            print("WARNING: ignoring invalid ATS weights")
    return weights


def _coverage(items: List[Dict], soft_weight: float = 0.5) -> Optional[float]:
    total = credit = 0.0
    for req in items:
        w = soft_weight if req["category"] == "soft_skill" else 1.0
        if req["category"] in ("education", "certification") and req["importance"] == "preferred":
            w = 0.5
        total += w
        credit += w * CREDIT[req["status"]]
    return 100 * credit / total if total else None


def _experience(job: Dict, candidate: Dict, items: List[Dict]) -> Optional[float]:
    parts = []
    need = job.get("min_years")
    if isinstance(need, (int, float)) and need > 0:
        have = max(0.0, float(candidate.get("relevant_years") or 0))
        parts.append(100.0 if have >= need else 100 * (have / need) ** 0.8)
    if items:
        parts.append(_coverage(items))
    return sum(parts) / len(parts) if parts else None


def _near_miss_on_years(req: Dict, need, have) -> bool:
    """A years-of-experience gate is only a knockout below half the years asked for.
    Recruiters pass candidates with 8 months against "1+ years"; not with none."""
    if req["category"] != "experience" or not isinstance(need, (int, float)) or need <= 0:
        return False
    return isinstance(have, (int, float)) and have >= need / 2


def _detail(items: List[Dict]) -> str:
    met = sum(r["status"] == "met" for r in items)
    partial = sum(r["status"] == "partial" for r in items)
    text = f"{met} of {len(items)} met"
    return text + (f", {partial} partly" if partial else "")


def score(requirements: List[Dict], job: Dict, candidate: Dict, keyword_score: Optional[float],
          format_score: float, semantic_score: Optional[float], style: str,
          overrides: Optional[Dict] = None) -> Dict:
    weights = _weights(style, overrides, semantic_score is not None)

    req = [r for r in requirements if r["category"] in SKILL_CATEGORIES and r["importance"] == "required"]
    pref = [r for r in requirements if r["category"] in SKILL_CATEGORIES and r["importance"] == "preferred"]
    exp = [r for r in requirements if r["category"] == "experience"]
    resp = [r for r in requirements if r["category"] == "responsibility"]
    edu = [r for r in requirements if r["category"] in ("education", "certification")]

    need = job.get("min_years")
    have = candidate.get("relevant_years")
    exp_detail = (f"{have:g} of {need:g} years" if isinstance(need, (int, float)) and need > 0
                  and isinstance(have, (int, float)) else _detail(exp) if exp else "")

    values = {
        "required": (_coverage(req), _detail(req) if req else ""),
        "preferred": (_coverage(pref), _detail(pref) if pref else ""),
        "experience": (_experience(job, candidate, exp), exp_detail),
        "responsibilities": (_coverage(resp), _detail(resp) if resp else ""),
        "education": (_coverage(edu), _detail(edu) if edu else ""),
        "keywords": (keyword_score, ""),
        "format": (format_score, ""),
        "semantic": (semantic_score, "Embedding similarity of the whole resume and job"),
    }

    components, total_weight, total = [], 0.0, 0.0
    for key, label in COMPONENTS.items():
        value, detail = values[key]
        weight = weights.get(key, 0.0)
        applies = value is not None and weight > 0
        components.append({"key": key, "label": label, "score": round(value) if value is not None else None,
                           "weight": weight, "applies": applies, "detail": detail})
        if applies:
            total_weight += weight
            total += weight * value

    # Weights of the parts that apply are rescaled to add up to 100%.
    for c in components:
        c["weight"] = round(100 * c["weight"] / total_weight) if c["applies"] and total_weight else 0
    overall = total / total_weight if total_weight else 0.0

    knockouts = [{"label": r["label"], "status": r["status"]} for r in requirements
                 if r["knockout"] and r["status"] == "missing" and not _near_miss_on_years(r, need, have)]
    capped = bool(knockouts) and overall > KNOCKOUT_CAP
    if capped:
        overall = KNOCKOUT_CAP

    overall = round(overall)
    verdict = ("strong" if overall >= 80 else "good" if overall >= 65 else "fair" if overall >= 50 else "low")
    return {
        "score": overall,
        "verdict": verdict,
        "style": style,
        "style_name": STYLE_NAMES[style],
        "components": [c for c in components if c["applies"] or c["key"] != "semantic"],
        "knockouts": knockouts,
        "capped": capped,
    }
