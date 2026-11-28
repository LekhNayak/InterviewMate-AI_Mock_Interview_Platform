# Semantic engine (optional)

The embedding part of the ATS service, kept separate so the main service fits on Vercel.

- `engine.py`: `all-MiniLM-L6-v2` sentence embeddings. `similarity_score()` adds a **Semantic similarity** component to the ATS score, and `best_resumes_for_jd()` searches the ChromaDB resume bank.
- `build_database.py`: builds that resume bank from PDFs in `placed_resume/`.

It needs PyTorch, which is larger than a Vercel function allows. The service never imports this folder directly. `semantic.load()` returns the engine only when both of these are true:

1. `ATS_SEMANTIC=1` is set.
2. The packages are installed: `pip install -r requirements-semantic.txt`.

Otherwise the score is computed without the semantic component, and the other weights are rescaled.

## Where it runs

| Setup | Semantic engine |
|---|---|
| Vercel | Off. `requirements.txt` has no PyTorch, and `vercel.json` leaves this folder out of the function. |
| Docker (`Dockerfile`) | On. It installs `requirements-semantic.txt` and sets `ATS_SEMANTIC=1`. |
| Local dev | Off unless you install `requirements-semantic.txt` and set `ATS_SEMANTIC=1`. |

## Resume bank

```bash
pip install -r requirements-semantic.txt
python -m semantic.build_database
```

PDFs are read from `placed_resume/` (or `PLACED_RESUME_PATH`) and stored in `resume_db/` (or `RESUME_DB_PATH`). `POST /api/analyze` with `include_similar=true` then returns the three closest resumes, and `GET /api/debug/db` reports the bank's size.
