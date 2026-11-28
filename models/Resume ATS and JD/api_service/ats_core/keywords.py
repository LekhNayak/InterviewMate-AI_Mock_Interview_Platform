"""Classic ATS keyword coverage: which of the job's terms appear in the resume.

Keywords come from two places. The requirement list supplies the important
terms with their synonyms (PostgreSQL / Postgres). Frequency analysis of the
job text adds terms the posting repeats, which keyword filters also weigh.
"""
import re
from collections import Counter
from typing import Dict, List

from .text import JD_BOILERPLATE, STOPWORDS, count_any, count_term, fold, search_terms

KEYWORD_CATEGORIES = {"skill", "tool", "knowledge", "certification", "language", "education"}
IMPORTANCE_WEIGHT = {"required": 3.0, "preferred": 1.5, "frequent": 1.0}


def _tokens(folded: str) -> List[str]:
    return [t.strip("./&") for t in folded.split() if t.strip("./&")]


def _useful(token: str) -> bool:
    return (len(token) > 2 or token in {"c", "r", "go", "ai", "ml", "ui", "ux", "qa", "hr", "bi", "seo", "c#", "c++"}) \
        and token not in STOPWORDS and token not in JD_BOILERPLATE and not token.isdigit()


def frequent_terms(jd_text: str, limit: int = 12) -> List[Dict]:
    """Terms the job posting repeats, phrases first. In a long posting a term needs 3
    mentions, since 2 can be chance (a company blurb repeats its own slogan)."""
    tokens = _tokens(fold(jd_text))
    word_min = 3 if len(tokens) > 400 else 2
    unigrams = Counter(t for t in tokens if _useful(t))
    bigrams = Counter(
        f"{a} {b}" for a, b in zip(tokens, tokens[1:]) if _useful(a) and _useful(b) and a != b
    )
    picked: List[Dict] = []
    for phrase, n in bigrams.most_common():
        if n < word_min or len(picked) >= limit // 2:
            break
        picked.append({"term": phrase, "jd_count": n})
    covered = {w for p in picked for w in p["term"].split()}
    for word, n in unigrams.most_common():
        if n < word_min or len(picked) >= limit:
            break
        if word in covered and n <= max(p["jd_count"] for p in picked if word in p["term"].split()):
            continue
        picked.append({"term": word, "jd_count": n})
    return picked


def keyword_report(requirements: List[Dict], jd_text: str, resume_text: str, exclude: List[str] = ()) -> Dict:
    """exclude: text whose terms are not keywords to add, such as the job title and company."""
    resume = fold(resume_text)
    excluded = " ".join(fold(e) for e in exclude if e)
    jd = fold(jd_text or "")
    rows: List[Dict] = []
    known: List[str] = []

    for req in requirements:
        if req["category"] not in KEYWORD_CATEGORIES:
            continue
        terms = search_terms(req["label"], req.get("aliases", []))
        known.extend(fold(t) for t in terms)
        rows.append({
            "term": req["label"],
            "importance": req["importance"],
            "jd_count": max(1, count_any(jd, terms)) if jd else 1,
            "resume_count": count_any(resume, terms),
            # The requirement is shown by the resume even if its exact words are not.
            "in_context": req.get("status") in ("met", "partial") and req.get("verified", True),
        })

    for item in frequent_terms(jd_text or ""):
        term = item["term"]
        if any(term == k or term in k.split() or k in term for k in known if k):
            continue
        if excluded and re.search(rf"(?<![a-z0-9]){re.escape(term)}(?![a-z0-9])", excluded):
            continue
        rows.append({"term": term, "importance": "frequent", "jd_count": item["jd_count"],
                     "resume_count": count_term(resume, term)})

    # match: "exact" when the term is written in the resume; "context" when the requirement
    # is shown but not in these words, which literal ATS filters can miss; "none" otherwise.
    for row in rows:
        row["match"] = "exact" if row["resume_count"] > 0 else "context" if row.pop("in_context", False) else "none"
        row["found"] = row["match"] == "exact"
    order = {"required": 0, "preferred": 1, "frequent": 2}
    rank = {"none": 0, "context": 1, "exact": 2}
    rows.sort(key=lambda r: (rank[r["match"]], order[r["importance"]], -r["jd_count"]))

    credit = {"exact": 1.0, "context": 0.75, "none": 0.0}
    total = sum(IMPORTANCE_WEIGHT[r["importance"]] for r in rows)
    score = (100 * sum(IMPORTANCE_WEIGHT[r["importance"]] * credit[r["match"]] for r in rows) / total
             if total else None)
    return {"keywords": rows, "score": score}

