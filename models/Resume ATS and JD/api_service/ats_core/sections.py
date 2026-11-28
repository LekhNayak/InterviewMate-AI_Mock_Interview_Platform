"""Find the standard resume sections by their headings, for any profession."""
import re
from typing import Dict, List

# Canonical section -> heading words an ATS recognises. Matched against short
# lines only, so "skills" inside a sentence is not taken for a heading.
SECTION_HEADINGS = {
    "summary": ["summary", "professional summary", "profile", "about me", "objective", "career objective",
                "career summary", "professional profile"],
    "experience": ["experience", "work experience", "professional experience", "employment",
                   "employment history", "work history", "career history", "internship", "internships",
                   "relevant experience", "industry experience", "clinical experience", "teaching experience"],
    "education": ["education", "academic background", "academics", "academic qualifications",
                  "educational qualifications", "qualifications"],
    "skills": ["skills", "technical skills", "key skills", "core skills", "core competencies",
               "competencies", "areas of expertise", "expertise", "technologies", "tech stack", "tools"],
    "projects": ["projects", "personal projects", "academic projects", "key projects", "selected projects"],
    "certifications": ["certifications", "certificates", "licenses", "licences", "licenses and certifications",
                       "courses", "training"],
    "achievements": ["achievements", "awards", "honors", "honours", "accomplishments", "awards and achievements"],
    "leadership": ["leadership", "positions of responsibility", "extracurricular", "extra curricular",
                   "activities", "volunteering", "volunteer experience"],
    "publications": ["publications", "research", "papers"],
    "languages": ["languages"],
}

_LOOKUP = {h: canonical for canonical, heads in SECTION_HEADINGS.items() for h in heads}


def _heading_key(line: str) -> str:
    return re.sub(r"[^a-z ]", "", line.lower().replace("&", " and ")).strip()


def detect_sections(text: str) -> Dict[str, str]:
    """Canonical section name -> its text, in the order the resume uses."""
    sections: Dict[str, List[str]] = {}
    current = "header"
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        key = _heading_key(line.rstrip(":"))
        words = key.split()
        canonical = _LOOKUP.get(key)
        if canonical is None and 1 <= len(words) <= 4:
            # Headings like "Work Experience & Internships" or "SKILLS / TOOLS".
            for heading, name in _LOOKUP.items():
                if key.startswith(heading + " ") or key.endswith(" " + heading):
                    canonical = name
                    break
        if canonical and len(words) <= 5:
            current = canonical
            sections.setdefault(current, [])
            continue
        sections.setdefault(current, []).append(line)
    return {name: "\n".join(lines) for name, lines in sections.items()}
