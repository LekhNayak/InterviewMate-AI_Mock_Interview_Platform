"""Embedding similarity (all-MiniLM-L6-v2) and the ChromaDB resume bank.

This is the scoring the service used before the evidence-based engine. It is
kept as an optional extra component: imported only through semantic.load().
"""
import os
from typing import Any, Dict, List

import chromadb
from sentence_transformers import SentenceTransformer, util

SERVICE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJECT_ROOT = os.path.dirname(SERVICE_DIR)
MODEL_NAME = "all-MiniLM-L6-v2"

_model = None
_client = None


def get_embedding_model() -> SentenceTransformer:
    global _model
    if _model is None:
        _model = SentenceTransformer(MODEL_NAME)
    return _model


def similarity(resume_text: str, jd_text: str) -> float:
    """Cosine similarity of the two texts, from -1 to 1 (in practice 0.1 to 0.8)."""
    model = get_embedding_model()
    return float(util.cos_sim(model.encode(resume_text), model.encode(jd_text)).item())


def similarity_score(resume_text: str, jd_text: str) -> float:
    """Similarity on a 0 to 100 scale. Unrelated texts land near 0.15 and a close
    fit near 0.65, so that range maps to 0 to 100. The earlier version multiplied
    by 1.5 instead, which put almost every resume above 80."""
    sim = similarity(resume_text, jd_text)
    return round(max(0.0, min(1.0, (sim - 0.15) / 0.5)) * 100, 1)


def resolve_resume_db_path() -> str:
    """The ChromaDB folder: RESUME_DB_PATH, else resume_db/ in the project or service folder."""
    env_path = os.getenv("RESUME_DB_PATH")
    if env_path and os.path.isdir(env_path):
        return env_path
    for candidate in (os.path.join(PROJECT_ROOT, "resume_db"), os.path.join(SERVICE_DIR, "resume_db")):
        if os.path.isdir(candidate):
            return candidate
    return os.path.join(PROJECT_ROOT, "resume_db")


def get_collection():
    global _client
    if _client is None:
        _client = chromadb.PersistentClient(path=resolve_resume_db_path())
    try:
        return _client.get_collection("resumes")
    except Exception:
        return _client.get_or_create_collection("resumes")


def best_resumes_for_jd(jd_text: str, top_k: int = 3) -> List[Dict[str, Any]]:
    """The resumes in the bank closest to the job. Empty when the bank is empty or missing."""
    try:
        collection = get_collection()
        if collection.count() == 0:
            return []
        embedding = get_embedding_model().encode(jd_text).tolist()
        results = collection.query(query_embeddings=[embedding], n_results=top_k)
        documents = results.get("documents", [[]])[0] if results else []
        metadatas = results.get("metadatas", [[]])[0] if results else []
        return [{"filename": meta.get("filename", "Unknown"), "snippet": (doc or "")[:700]}
                for doc, meta in zip(documents, metadatas)]
    except Exception as err:
        print(f"WARNING: could not query the resume bank: {err}")
        return []


def diagnostics() -> Dict[str, Any]:
    path = resolve_resume_db_path()
    try:
        count = get_collection().count()
    except Exception as err:
        count = f"error: {err}"
    return {"resume_db_path": path, "collection": "resumes", "count": count, "model": MODEL_NAME}
