"""ATS scoring and JD matching that runs without PyTorch, so it fits on Vercel.

How a resume is scored against a job:

1. pdf.py reads the PDF the way an ATS would: plain text, page count, and how
   much of it could be read at all.
2. requirements.py has the language model split the job into atomic requirements
   (required or preferred, with knockout gates such as a licence or minimum years)
   and judge each one against the resume, quoting the resume as evidence.
   verify() then checks every quote really is in the resume and every keyword
   really appears, so a claimed match the text does not support is downgraded.
3. keywords.py measures classic ATS keyword coverage, with synonyms.
4. checks.py runs format and readability checks (contact details, headings,
   length, bullets, metrics, action verbs and so on).
5. scoring.py combines these into one score with weights that depend on the
   chosen scoring style. The model never sets the score itself.
6. insights.py writes the coaching text from the computed results.

The optional semantic/ package (sentence-transformers and ChromaDB) adds an
embedding similarity component when it is installed. See semantic/README.md.
"""
