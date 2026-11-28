"""Text normalisation and term matching shared by every check."""
import re
import unicodedata
from functools import lru_cache
from typing import Iterable, List

# Characters PDF fonts produce in place of icons and bullets, which an ATS
# cannot read: the private-use area, the replacement character and (cid:N).
UNREADABLE = re.compile(r"[-�]|\(cid:\d+\)")


def normalize(text: str) -> str:
    """Unicode-normalise and straighten quotes and dashes, keeping line breaks."""
    text = unicodedata.normalize("NFKC", text or "")
    for a, b in (("‘", "'"), ("’", "'"), ("“", '"'), ("”", '"'),
                 ("–", "-"), ("—", "-"), ("−", "-"), (" ", " ")):
        text = text.replace(a, b)
    return text


def fold(text: str) -> str:
    """Lower-case text for matching. Keeps the symbols in names like C++, C#,
    Node.js and CI/CD; hyphens become spaces, so real-time matches real time."""
    text = normalize(text).lower()
    text = re.sub(r"[-_]", " ", text)
    text = re.sub(r"[^a-z0-9+#./&\s]", " ", text)
    text = re.sub(r"(?<![a-z0-9])\.|\.(?![a-z0-9])", " ", text)  # sentence full stops
    return re.sub(r"\s+", " ", text).strip()


# Word endings that keep the meaning: API/APIs, test/testing, REST/RESTful, deploy/deployed.
_ENDINGS = "(?:s|es|ed|ing|ful|al|er|ers)?"


@lru_cache(maxsize=2048)
def _term_pattern(term: str) -> re.Pattern:
    words = []
    for word in term.split(" "):
        escaped = re.escape(word)
        # Plain words of 3+ letters may take an ending; names like C++, Node.js and Go stay exact.
        words.append(escaped + _ENDINGS if word.isalpha() and len(word) >= 3 else escaped)
    body = r"\s+".join(words)
    return re.compile(rf"(?<![a-z0-9+#]){body}(?![a-z0-9+#])")


def count_term(folded_text: str, term: str) -> int:
    """How many times a term occurs as a whole word or phrase in folded text."""
    term = fold(term)
    if not term:
        return 0
    return len(_term_pattern(term).findall(folded_text))


def count_any(folded_text: str, terms: Iterable[str]) -> int:
    return sum(count_term(folded_text, t) for t in {fold(t) for t in terms if t})


_FILLER = re.compile(
    r"\b(?:knowledge|experience|skills?|proficiency|proficient|fluency|fluent|basics|fundamentals|methodology|"
    r"methodologies|certification|certificate|certified|degree|expertise|familiarity|understanding)\b",
    re.I,
)


def search_terms(label: str, aliases: Iterable[str] = ()) -> List[str]:
    """Every form of a requirement worth searching for. Splits alternatives the
    model wrote into one label ("Agile / Scrum", "Cloud deployment (Azure)") and
    drops filler words ("BLS certification" -> "BLS"). Keeps CI/CD and TCP/IP whole."""
    out: List[str] = []
    seen = set()
    for term in (label, *aliases):
        parts = [term, *re.split(r"\s+/\s+|\s*[()]\s*|\s+or\s+|\s+&\s+|,\s*", term or "")]
        for part in parts:
            for candidate in (part, _FILLER.sub(" ", part or "")):
                candidate = re.sub(r"\s+", " ", candidate or "").strip(" -,&")
                key = fold(candidate)
                if key and len(key) >= 2 and key not in seen and key not in STOPWORDS:
                    seen.add(key)
                    out.append(candidate)
    return out


def contains_quote(folded_text: str, quote: str) -> bool:
    """True when a quote from the model really appears in the resume. Allows
    small differences from PDF line breaks: 85% of its words, in a short span.
    A quote shortened with "..." passes when every fragment between the dots does."""
    fragments = [f for f in re.split(r"\.\.\.+|…", normalize(quote)) if fold(f)]
    if len(fragments) > 1:
        return all(_contains_fragment(folded_text, f) for f in fragments)
    return _contains_fragment(folded_text, quote)


def _contains_fragment(folded_text: str, quote: str) -> bool:
    q = fold(quote)
    if not q:
        return False
    if q in folded_text:
        return True
    words = [w for w in q.split() if len(w) > 2]
    if len(words) < 3:
        return False
    tokens = folded_text.split()
    window = len(q.split()) + 6
    needed = max(3, int(len(words) * 0.85 + 0.5))
    wanted = set(words)
    for start in range(0, max(1, len(tokens) - window + 1)):
        if len(wanted & set(tokens[start:start + window])) >= needed:
            return True
    return False


STOPWORDS = frozenset("""
a about above across after again against all almost also am among an and any are as at be because been
before being below between both but by can could did do does doing down during each either else etc
ever every few for from further get gets had has have having he her here hers him his how however i if
in into is it its itself just least less like make many may me might more most much must my need
needs neither no nor not now of off often on once one only or other others our ours out over own
per please rather same shall she should since so some such than that the their theirs them then there
these they this those though through to too under until up upon us use used uses using very via was
we well were what when where whether which while who whom whose why will with within without would
yet you your yours
""".split())

# Words every job posting uses, which say nothing about the job itself.
JD_BOILERPLATE = frozenset("""
ability able candidate candidates company team teams work working role roles position job jobs
experience experienced year years strong excellent good great plus preferred required requirement
requirements responsibility responsibilities qualification qualifications skill skills knowledge
understanding including include includes include etc looking join opportunity environment
apply applicant applicants description new key based across ensure related relevant level levels
minimum must should will within part full time day days week weeks month months degree equivalent
field fields bachelor bachelors master masters preferably ideal ideally successful success help
helps support supports provide provides make makes take takes want wants seeking build builds
benefits salary location office remote hybrid onsite site employer equal employment
system systems solution solutions tool tools platform platforms powered driven leading world worldwide global
""".split())
