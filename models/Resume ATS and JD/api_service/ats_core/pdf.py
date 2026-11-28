"""Read a resume PDF the way an applicant tracking system sees it: as plain text."""
from dataclasses import dataclass
from io import BytesIO

from pypdf import PdfReader

from .text import normalize


class UnreadableResume(ValueError):
    """The PDF could not be opened, or holds no text (a scan or an image)."""


@dataclass
class ResumeDocument:
    text: str
    pages: int
    size_bytes: int

    @property
    def chars(self) -> int:
        return len(self.text.strip())


def read_pdf(pdf_bytes: bytes) -> ResumeDocument:
    try:
        reader = PdfReader(BytesIO(pdf_bytes))
        if reader.is_encrypted:
            reader.decrypt("")
        pages = [page.extract_text() or "" for page in reader.pages]
    except Exception as err:
        raise UnreadableResume(f"The PDF could not be opened: {err}") from err

    text = normalize("\n".join(pages))
    doc = ResumeDocument(text=text, pages=len(pages), size_bytes=len(pdf_bytes))
    if doc.chars < 80:
        raise UnreadableResume(
            "No text could be read from this PDF. It is probably a scan or an image, "
            "which applicant tracking systems cannot read either. Export it from a text editor instead."
        )
    return doc
