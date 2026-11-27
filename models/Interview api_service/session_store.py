"""Interview sessions in MongoDB.

On Vercel each request can run in a different short-lived instance, so a session
has to live outside the process. MONGO_URI is the same Atlas database the API uses;
sessions go in their own collection.

Sessions are working state: the browser saves the finished interview through the
API. A TTL index deletes them SESSION_TTL_DAYS after they start.
"""
import os
from datetime import datetime, timezone
from typing import Dict, Optional

from pymongo import ASCENDING, MongoClient
from pymongo.collection import Collection

COLLECTION = "interview_sessions"
DEFAULT_DB = "interviewmate"
SESSION_TTL_DAYS = 7

_client: Optional[MongoClient] = None
_collection: Optional[Collection] = None


def _sessions() -> Collection:
    # One client per process, created on first use and reused by warm instances.
    global _client, _collection
    if _collection is not None:
        return _collection

    uri = (os.getenv("MONGO_URI") or "").strip()
    if not uri:
        raise RuntimeError("Missing MONGO_URI in the interview service .env")

    _client = MongoClient(uri, serverSelectionTimeoutMS=10_000)
    collection = _client.get_default_database(DEFAULT_DB)[COLLECTION]
    collection.create_index([("session_id", ASCENDING)], unique=True)
    collection.create_index("created_at", expireAfterSeconds=SESSION_TTL_DAYS * 24 * 3600)
    _collection = collection
    return collection


def insert_session(session: Dict) -> None:
    doc = dict(session, created_at=datetime.now(timezone.utc))
    _sessions().insert_one(doc)


def find_session(session_id: str) -> Optional[Dict]:
    return _sessions().find_one({"session_id": session_id}, {"_id": 0, "created_at": 0})


def save_session(session: Dict) -> None:
    fields = {k: v for k, v in session.items() if k not in ("_id", "created_at")}
    result = _sessions().update_one({"session_id": session["session_id"]}, {"$set": fields})
    if result.matched_count == 0:
        raise ValueError("Session not found while saving")
