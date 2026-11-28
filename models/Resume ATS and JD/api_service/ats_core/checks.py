"""Format and readability checks: can an ATS parse this resume, and does it read well?

Each check answers pass, warn or fail with a reason. They apply to any profession.
"""
import re
from typing import Dict, List

from .pdf import ResumeDocument
from .text import UNREADABLE

EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
PHONE_CANDIDATE = re.compile(r"\+?\(?\d[\d\s().-]{8,16}\d")
LINK = re.compile(r"(linkedin\.com|github\.com|gitlab\.com|behance\.net|dribbble\.com|portfolio|https?://|www\.)", re.I)
BULLET = re.compile(r"^\s*(?:[•●▪◦‣⁃∙·■□–\-\*>]|\d{1,2}[.)])\s+")
DATE = re.compile(
    r"\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s*'?\d{2,4}\b"
    r"|\b\d{1,2}/\d{4}\b|\b(?:19|20)\d{2}\s*(?:-|to)\s*(?:(?:19|20)\d{2}|present|current|now)\b",
    re.I,
)
METRIC = re.compile(
    r"\d+(?:\.\d+)?\s*(?:%|x\b|\+|k\b|m\b|mn\b|bn\b|lakh|crore|cr\b|users|customers|clients|students|"
    r"patients|hours|hrs|ms\b|seconds|minutes|days|people|members|projects|accounts|leads|deals|sales)"
    r"|[$₹€£]\s*\d|\d+(?:\.\d+)?\s*(?:percent|times)",
    re.I,
)
WEAK_PHRASES = ["responsible for", "worked on", "helped with", "helped to", "duties included",
                "tasks included", "involved in", "assisted with", "was part of", "participated in"]
PRONOUN = re.compile(r"(?<![\w.&])(?:I|[Mm]e|[Mm]y|[Mm]yself)(?![\w.&'])")

# Verbs that open strong achievement bullets, across professions.
ACTION_VERBS = frozenset("""
accelerated achieved acquired adapted addressed administered advised advocated analyzed analysed
architected arranged assembled assessed audited authored automated balanced boosted briefed built
calculated campaigned captured championed classified closed coached collaborated compiled completed
composed conceived conceptualized conducted configured consolidated constructed consulted contributed
controlled converted coordinated created cultivated cut debugged decreased defined delivered demonstrated
deployed designed developed devised diagnosed directed discovered documented doubled drafted drove
earned edited educated eliminated enabled engineered enhanced established evaluated exceeded executed
expanded expedited facilitated finalized forecasted formulated founded generated grew guided handled
headed hired identified implemented improved increased influenced initiated innovated inspected
installed instituted instructed integrated interpreted interviewed introduced invented investigated
launched led leveraged maintained managed marketed maximized measured mentored migrated minimized
mobilized modeled modelled modernized monitored motivated negotiated operated optimized orchestrated
organized originated outperformed overhauled oversaw partnered performed persuaded piloted pioneered
planned prepared presented prevented prioritized processed produced programmed promoted proposed
prototyped published raised ran rebuilt recommended reconciled recruited redesigned reduced refactored
refined reorganized replaced reported represented researched resolved restructured revamped reviewed
revised saved scaled scheduled secured selected served shipped simplified solved spearheaded standardized
started streamlined strengthened structured supervised surpassed taught tested trained transformed
translated treated tripled troubleshot tuned unified upgraded validated visualized won wrote
""".split())


def _has_phone(text: str) -> bool:
    # 10 to 13 digits with the usual separators, so year ranges do not count.
    return any(10 <= len(re.sub(r"\D", "", m)) <= 13 for m in PHONE_CANDIDATE.findall(text))


def _check(check_id: str, label: str, status: str, detail: str, weight: float) -> Dict:
    return {"id": check_id, "label": label, "status": status, "detail": detail, "weight": weight}


def run_checks(doc: ResumeDocument, sections: Dict[str, str]) -> List[Dict]:
    text = doc.text
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    words = len(re.findall(r"[A-Za-z][A-Za-z'+#.-]*", text))
    bullets = [BULLET.sub("", l) for l in lines if BULLET.match(l)]
    checks: List[Dict] = []

    per_page = doc.chars / max(doc.pages, 1)
    if per_page >= 300:
        checks.append(_check("text", "Text can be read", "pass", "All pages contain selectable text.", 3))
    elif per_page >= 100:
        checks.append(_check("text", "Text can be read", "warn",
                             "Little text per page. Parts may be images an ATS cannot read.", 3))
    else:
        checks.append(_check("text", "Text can be read", "fail",
                             "Almost no text per page. The resume looks scanned or image-based.", 3))

    unreadable = len(UNREADABLE.findall(text))
    if unreadable == 0:
        checks.append(_check("glyphs", "No unreadable symbols", "pass", "No icon fonts or broken characters.", 1.5))
    else:
        checks.append(_check("glyphs", "No unreadable symbols", "warn" if unreadable <= 6 else "fail",
                             f"{unreadable} characters came out as unreadable symbols, usually icons or "
                             "special bullet fonts. Use plain text bullets and words like 'Email:'.", 1.5))

    has_email, has_phone = bool(EMAIL.search(text)), _has_phone(text)
    if has_email and has_phone:
        checks.append(_check("contact", "Email and phone", "pass", "Both found.", 2))
    else:
        missing = " and ".join(n for n, ok in (("an email", has_email), ("a phone number", has_phone)) if not ok)
        checks.append(_check("contact", "Email and phone", "fail",
                             f"No {missing} found as text. Recruiters and ATS forms need it.", 2))

    checks.append(_check("links", "Profile links", "pass" if LINK.search(text) else "warn",
                         "LinkedIn, portfolio or other profile link found." if LINK.search(text)
                         else "No LinkedIn or portfolio link. Most recruiters look for one.", 0.75))

    core = {"experience": "experience" in sections or "projects" in sections,
            "education": "education" in sections, "skills": "skills" in sections}
    missing = [name for name, ok in core.items() if not ok]
    found = sorted(n for n in sections if n != "header")
    if not missing:
        checks.append(_check("sections", "Standard section headings", "pass",
                             f"Found: {', '.join(found)}.", 2))
    else:
        checks.append(_check("sections", "Standard section headings", "warn" if len(missing) == 1 else "fail",
                             f"No standard heading for {', '.join(missing)}. ATS map content by headings such as "
                             "'Experience', 'Education' and 'Skills'.", 2))

    if 350 <= words <= 1000 and doc.pages <= 2:
        status, detail = "pass", f"{words} words on {doc.pages} page{'s' if doc.pages > 1 else ''}."
    elif words < 200 or words > 1400 or doc.pages > 3:
        status, detail = "fail", f"{words} words on {doc.pages} pages. Aim for 400 to 900 words on 1 to 2 pages."
    else:
        status, detail = "warn", f"{words} words on {doc.pages} pages. 400 to 900 words on 1 to 2 pages reads best."
    checks.append(_check("length", "Length", status, detail, 1.5))

    if len(bullets) >= 6:
        checks.append(_check("bullets", "Bullet points", "pass", f"{len(bullets)} bullet points.", 1))
    else:
        checks.append(_check("bullets", "Bullet points", "warn" if len(bullets) >= 3 else "fail",
                             f"Only {len(bullets)} bullet points. Short bullets are easier to scan than paragraphs.", 1))

    metric_lines = [l for l in lines if METRIC.search(l)]
    n = len(metric_lines)
    checks.append(_check("metrics", "Measurable results", "pass" if n >= 4 else "warn" if n >= 2 else "fail",
                         f"{n} lines with numbers such as %, counts, money or time saved."
                         + ("" if n >= 4 else " Add results like 'cut load time by 40%'."), 2))

    if len(bullets) >= 3:
        strong = sum(1 for b in bullets if b.split()[0].lower().strip(",.:;") in ACTION_VERBS) if bullets else 0
        share = strong / len(bullets)
        checks.append(_check("verbs", "Action verbs", "pass" if share >= 0.5 else "warn" if share >= 0.25 else "fail",
                             f"{strong} of {len(bullets)} bullets start with an action verb such as "
                             "'Built', 'Led' or 'Reduced'.", 1.5))

    lowered = text.lower()
    weak = {p: lowered.count(p) for p in WEAK_PHRASES if p in lowered}
    total_weak = sum(weak.values())
    checks.append(_check("weak", "Weak phrases", "pass" if total_weak == 0 else "warn" if total_weak <= 2 else "fail",
                         "None found." if not weak else
                         "Found: " + ", ".join(f"'{p}'" for p in weak) + ". Say what you achieved instead.", 1))

    pronouns = len(PRONOUN.findall(text))
    checks.append(_check("pronouns", "No first person", "pass" if pronouns <= 2 else "warn" if pronouns <= 6 else "fail",
                         f"{pronouns} uses of I, me or my." + ("" if pronouns <= 2 else " Resumes usually leave them out."), 0.5))

    dates = len(DATE.findall(text))
    checks.append(_check("dates", "Dates on roles", "pass" if dates >= 2 else "warn",
                         f"{dates} dates found." + ("" if dates >= 2 else
                                                    " ATS work out experience from dates such as 'Jun 2024 - Present'."), 1))
    return checks


def format_score(checks: List[Dict]) -> float:
    credit = {"pass": 1.0, "warn": 0.5, "fail": 0.0}
    total = sum(c["weight"] for c in checks)
    return 100 * sum(c["weight"] * credit[c["status"]] for c in checks) / total if total else 0.0
