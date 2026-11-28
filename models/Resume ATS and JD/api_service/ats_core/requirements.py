"""Turn a job into a fixed rubric of requirements, then judge a resume against it.

Two steps, so the same job is always scored against the same rubric:

1. extract_rubric() reads only the job (or a job role) and lists its atomic
   requirements: required or preferred, knockout gates, synonyms. The caller can
   store the rubric and pass it back for the next analysis of the same job, so
   re-running an analysis does not change what is being measured.
2. judge() reads the rubric and the resume and marks each requirement met,
   partial or missing, quoting the resume as evidence.

verify() then checks every quote against the real text and looks for the terms
themselves, so a claimed match the resume does not support is downgraded.
"""
import re
from typing import Dict, List, Optional

from .llm import AnalysisError, complete_json
from .text import contains_quote, count_any, fold, search_terms

RUBRIC_VERSION = 1  # bump when the extraction prompt changes, so stored rubrics are rebuilt
CATEGORIES = ["skill", "tool", "knowledge", "experience", "responsibility", "education",
              "certification", "language", "soft_skill", "other"]
SENIORITIES = ["intern", "entry", "mid", "senior", "lead", "executive", "unspecified"]
MAX_REQUIREMENTS = 22
RESUME_CHARS = 9000
JOB_CHARS = 6000

# Fixed values (category, status...) are not enums in these schemas: strict mode rejects the whole
# answer over one odd value, which wastes a full generation. The prompts list them and the code
# below normalises them.
RUBRIC_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["job", "requirements"],
    "properties": {
        "job": {
            "type": "object",
            "additionalProperties": False,
            "required": ["title", "company", "seniority", "domain", "min_years"],
            "properties": {
                "title": {"type": "string"},
                "company": {"type": "string"},
                "seniority": {"type": "string"},
                "domain": {"type": "string"},
                "min_years": {"type": ["number", "null"]},
            },
        },
        "requirements": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["label", "category", "importance", "knockout", "aliases"],
                "properties": {
                    "label": {"type": "string"},
                    "category": {"type": "string"},
                    "importance": {"type": "string"},
                    "knockout": {"type": "boolean"},
                    "aliases": {"type": "array", "items": {"type": "string"}},
                },
            },
        },
    },
}

JUDGE_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["candidate", "judgements"],
    "properties": {
        "candidate": {
            "type": "object",
            "additionalProperties": False,
            "required": ["headline", "relevant_years", "years_evidence"],
            "properties": {
                "headline": {"type": "string"},
                "relevant_years": {"type": "number"},
                "years_evidence": {"type": "string"},
            },
        },
        "judgements": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["id", "status", "evidence", "note"],
                "properties": {
                    "id": {"type": "integer"},
                    "status": {"type": "string"},
                    "evidence": {"type": "string"},
                    "note": {"type": "string"},
                },
            },
        },
    },
}

PROFESSIONS = ("software, data, healthcare, finance, sales, marketing, design, education, operations, law, "
               "skilled trades and more")

RUBRIC_SYSTEM = (f"You are an expert recruiter for every profession: {PROFESSIONS}. You turn a job into the "
                 "precise rubric an applicant tracking system screens resumes against. Answer with JSON only.")

RUBRIC_INSTRUCTIONS = """List the requirements of the TARGET JOB as a screening rubric.

IMPORTANT, alternatives: when the job accepts any one of several items ("Python, Go, Java, Node.js or similar",
"AWS or GCP", "Kafka, RabbitMQ or SQS", "one of"), it is ONE requirement, never one per item. Its label names the
group in 1 to 4 words ("Programming language", "Cloud platform", "Message queue") and its aliases list the
alternatives the job names. A candidate with any one of them meets it.

- Atomic: one skill, tool, qualification, credential or responsibility each. Split "Python and Go" into two
  (both are needed), but never split alternatives (see above).
- 8 to 20 requirements, the most important first. Skip generic filler such as "team player" or "fast-paced
  environment" unless the job stresses it.
- importance: "required" when the job says must, required, minimum or essential, or lists it as a core
  qualification. "preferred" for nice to have, preferred, bonus, plus or familiarity. When a job lists skills
  without saying, treat the core stack as required and secondary or alternative items as preferred.
- knockout: true only for hard gates a recruiter screens out on: a licence or registration, a mandatory
  certification, a minimum number of years the job states, a degree the job explicitly requires, work
  authorisation, security clearance, or a required spoken language. Otherwise false.
- category, one of: skill (abilities and methods), tool (software, platforms, programming languages, equipment),
  knowledge (domain or subject knowledge), experience (years or kind of experience), responsibility (duties of the
  job), education, certification (licences and certifications), language (spoken languages), soft_skill, other.
- label: the short term a recruiter would type into an ATS search, 1 to 5 words, as it would appear in a resume:
  "PostgreSQL", "Kubernetes", "Patient triage", "B2B SaaS sales", "BLS", "B.Sc. Nursing", "Marathi". No
  parentheses, no " / " between alternatives (put alternatives in aliases), and no filler words such as
  knowledge, experience, skills, proficiency, fluency, basics or methodology. Experience and responsibility
  requirements may be short phrases: "3+ years backend development", "Assess and triage patients".
- aliases: 0 to 6 other ways the same thing is written: abbreviations, spellings, versions, close synonyms
  ("Postgres"; "K8s"; "Amazon Web Services" for AWS). Never a different technology or skill, except the
  alternatives of a group (see IMPORTANT above).
- job: title, company ("" when not given), seniority (one of intern, entry, mid, senior, lead, executive,
  unspecified), domain (industry and function in a few words), min_years (the minimum years of experience the job
  states, or null). When the job gives a range ("0-2 years") or conflicting figures, use the lowest. Mark a years
  requirement as a knockout only when that lowest minimum is 1 or more.

Use exactly these lower-case values: category as listed above; importance one of required, preferred."""

JUDGE_SYSTEM = ("You are a meticulous recruiter screening a resume against a fixed rubric. You judge strictly "
                "from what the resume says, and you quote it exactly. Answer with JSON only.")

JUDGE_INSTRUCTIONS = """Judge the RESUME against every requirement in the RUBRIC. Return one judgement per id.

- status, one of:
  met: the resume clearly lists or demonstrates it.
  partial: related or weaker evidence: a close alternative (MySQL for PostgreSQL), only coursework or a personal
  project where professional use is asked, fewer years than required, or a bare mention.
  missing: nothing in the resume supports it.
- evidence: for met and partial, copy 3 to 25 words VERBATIM from the resume that support the judgement. Never
  paraphrase, and do not shorten with "...". Use "" when missing.
- note: at most 15 words explaining a partial or missing judgement ("Uses MySQL, not PostgreSQL"). "" for met.
- Judge only from the resume text. A job title alone does not prove a skill.
- Spoken languages: a resume written well in a language shows written command of it, so mark it partial (note
  "Resume is written in it") unless the resume states the language, then met.
- candidate: headline (current or latest role in under 10 words); relevant_years: years of professional experience
  relevant to this job, counting internships and part-time work in proportion and excluding study and personal
  projects; years_evidence: the dates you counted, briefly.

Use exactly these lower-case values for status: met, partial, missing."""

CATEGORY_VARIANTS = {"technical skill": "skill", "hard skill": "skill", "method": "skill", "technology": "tool",
                     "software": "tool", "platform": "tool", "programming language": "tool", "framework": "tool",
                     "domain": "knowledge", "domain knowledge": "knowledge", "duty": "responsibility",
                     "responsibilities": "responsibility", "qualification": "education", "degree": "education",
                     "license": "certification", "licence": "certification", "certificate": "certification",
                     "spoken language": "language", "soft skill": "soft_skill", "soft-skill": "soft_skill"}
SENIORITY_VARIANTS = {"internship": "intern", "entry level": "entry", "entry-level": "entry", "junior": "entry",
                      "fresher": "entry", "graduate": "entry", "mid level": "mid", "mid-level": "mid",
                      "intermediate": "mid", "senior level": "senior", "staff": "senior", "principal": "lead",
                      "manager": "lead", "director": "executive", "vp": "executive", "c-level": "executive"}
IMPORTANCE_VARIANTS = {"must have": "required", "mandatory": "required", "essential": "required",
                       "nice to have": "preferred", "optional": "preferred", "bonus": "preferred"}
STATUS_VARIANTS = {"yes": "met", "matched": "met", "present": "met", "partially met": "partial",
                   "partly": "partial", "no": "missing", "not met": "missing", "absent": "missing"}


def _enum(value, allowed: List[str], variants: Dict[str, str], default: str) -> str:
    key = str(value or "").strip().lower().replace("_", " ")
    for candidate in (key, key.replace(" ", "_"), variants.get(key, "")):
        if candidate in allowed:
            return candidate
    return default


def _number(value) -> Optional[float]:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number >= 0 else None


def _job_block(jd_text: Optional[str], job_role: Optional[str]) -> str:
    if jd_text and jd_text.strip():
        return jd_text.strip()[:JOB_CHARS]
    return (f'No job description was given. The target is the role "{job_role}". List the requirements a typical '
            "current job posting for this role would include, at the level its title implies (mid-level when "
            "unclear). Mark only the core essentials as required, and set min_years only if the title implies it.")


# --- Rubric ---

def clean_rubric(data: Dict) -> Dict:
    """Normalise a rubric from the model, or one passed back by the caller."""
    job = data.get("job") if isinstance(data.get("job"), dict) else {}
    items, seen = [], set()
    for raw in data.get("requirements") or []:
        if not isinstance(raw, dict):
            continue
        label = str(raw.get("label", "")).strip()[:80]
        if not label or fold(label) in seen:
            continue
        seen.add(fold(label))
        importance = _enum(raw.get("importance"), ["required", "preferred"], IMPORTANCE_VARIANTS, "required")
        aliases: List[str] = []
        for alias in raw.get("aliases") or []:
            alias = str(alias).strip()[:60]
            if alias and fold(alias) != fold(label) and fold(alias) not in {fold(a) for a in aliases}:
                aliases.append(alias)
        items.append({
            "label": label,
            "category": _enum(raw.get("category"), CATEGORIES, CATEGORY_VARIANTS, "other"),
            "importance": importance,
            "knockout": raw.get("knockout") in (True, "true", "True", 1) and importance == "required",
            "aliases": aliases[:6],
        })
        if len(items) >= MAX_REQUIREMENTS:
            break
    if not items:
        raise AnalysisError("No requirements could be read from the job.")
    return {
        "version": RUBRIC_VERSION,
        "job": {
            "title": str(job.get("title") or "").strip(),
            "company": str(job.get("company") or "").strip(),
            "seniority": _enum(job.get("seniority"), SENIORITIES, SENIORITY_VARIANTS, "unspecified"),
            "domain": str(job.get("domain") or "").strip(),
            "min_years": _number(job.get("min_years")) or None,
        },
        "requirements": items,
    }


def usable_rubric(rubric) -> Optional[Dict]:
    """A rubric passed in by the caller, if it is current and well formed."""
    if not isinstance(rubric, dict) or rubric.get("version") != RUBRIC_VERSION:
        return None
    try:
        return clean_rubric(rubric)
    except AnalysisError:
        return None


def extract_rubric(jd_text: Optional[str], job_role: Optional[str]) -> Dict:
    user = RUBRIC_INSTRUCTIONS + "\n\nTARGET JOB\n<<<\n" + _job_block(jd_text, job_role) + "\n>>>"
    rubric = clean_rubric(complete_json(RUBRIC_SYSTEM, user, "job_rubric", RUBRIC_SCHEMA, max_tokens=2500))
    if not jd_text and job_role and not rubric["job"]["title"]:
        rubric["job"]["title"] = job_role
    return rubric


# --- Judging ---

def _rubric_lines(rubric: Dict) -> str:
    lines = []
    for i, req in enumerate(rubric["requirements"], 1):
        also = f" (also written: {', '.join(req['aliases'])})" if req["aliases"] else ""
        lines.append(f"{i}. [{req['importance']}, {req['category']}] {req['label']}{also}")
    job = rubric["job"]
    head = f"Job: {job['title'] or 'unknown title'}"
    if job["min_years"]:
        head += f", minimum {job['min_years']:g} years"
    return head + "\n" + "\n".join(lines)


def judge(rubric: Dict, resume_text: str) -> Dict:
    user = (JUDGE_INSTRUCTIONS + "\n\nRUBRIC\n<<<\n" + _rubric_lines(rubric) + "\n>>>\n\nRESUME\n<<<\n"
            + resume_text[:RESUME_CHARS] + "\n>>>")
    data = complete_json(JUDGE_SYSTEM, user, "rubric_judgement", JUDGE_SCHEMA, max_tokens=3000)

    by_id = {}
    for item in data.get("judgements") or []:
        try:
            by_id[int(item.get("id"))] = item
        except (TypeError, ValueError):
            continue
    requirements = []
    for i, req in enumerate(rubric["requirements"], 1):
        j = by_id.get(i, {})
        requirements.append({
            **req,
            "status": _enum(j.get("status"), ["met", "partial", "missing"], STATUS_VARIANTS, "missing"),
            "evidence": str(j.get("evidence") or "").strip()[:300],
            "note": str(j.get("note") or "").strip()[:160],
        })

    candidate = data.get("candidate") if isinstance(data.get("candidate"), dict) else {}
    return {
        "candidate": {
            "headline": str(candidate.get("headline") or "").strip(),
            "relevant_years": _number(candidate.get("relevant_years")) or 0.0,
            "years_evidence": str(candidate.get("years_evidence") or "").strip(),
        },
        "requirements": requirements,
    }


# --- Evidence check ---

def _mention(resume_text: str, terms: List[str]) -> str:
    """A short excerpt around the first mention of any term, for display."""
    for term in sorted(terms, key=len, reverse=True):
        m = re.search(rf"(?<![A-Za-z0-9]){re.escape(term)}(?![A-Za-z0-9])", resume_text, re.I)
        if m:
            start = resume_text.rfind(" ", 0, max(0, m.start() - 60)) + 1
            end = resume_text.find(" ", min(len(resume_text), m.end() + 60))
            return re.sub(r"\s+", " ", resume_text[start:end if end != -1 else None]).strip()
    return ""


VERIFIABLE_BY_KEYWORD = {"skill", "tool", "knowledge", "certification", "language", "education"}


def verify(requirements: List[Dict], resume_text: str) -> List[Dict]:
    folded = fold(resume_text)
    out = []
    for req in requirements:
        req = dict(req)
        terms = search_terms(req["label"], req["aliases"])
        mentions = count_any(folded, terms)
        quote_ok = bool(req["evidence"]) and contains_quote(folded, req["evidence"])
        verified = True

        if req["status"] in ("met", "partial") and not quote_ok:
            if mentions:
                req["evidence"] = _mention(resume_text, terms) or req["evidence"]
            else:
                # Neither the model's quote nor the term itself is in the resume.
                verified = False
                if req["status"] == "met":
                    req["status"] = "partial"
                    req["note"] = req["note"] or "Claimed, but the resume does not clearly show it."
                req["evidence"] = ""
        elif req["status"] == "missing" and mentions and req["category"] in VERIFIABLE_BY_KEYWORD:
            # Keyword filters would find it, so it is not fully missing.
            req["status"] = "partial"
            req["note"] = req["note"] or "Mentioned, but without context showing how it was used."
            req["evidence"] = _mention(resume_text, terms)

        req["verified"] = verified
        req["mentions"] = mentions
        out.append(req)
    return out
