"""Optional embedding engine: sentence-transformers similarity and a ChromaDB resume bank.

It needs PyTorch, which is too large for Vercel, so the main service never
imports it directly. load() returns the engine only when it is switched on
(ATS_SEMANTIC=1) and its packages are installed; otherwise None, and the ATS
score is computed without the "Semantic similarity" component.

Install it with:  pip install -r requirements-semantic.txt   (the Dockerfile does)
"""
import os
from types import ModuleType
from typing import Optional

_engine: Optional[ModuleType] = None
_tried = False


def enabled() -> bool:
    return os.getenv("ATS_SEMANTIC", "").strip().lower() in ("1", "true", "yes", "on")


def load() -> Optional[ModuleType]:
    """The semantic engine module, or None when it is off or not installed."""
    global _engine, _tried
    if _tried:
        return _engine
    _tried = True
    if not enabled():
        return None
    try:
        from . import engine  # imports torch and sentence-transformers
        _engine = engine
    except ImportError as err:
        print(f"WARNING: ATS_SEMANTIC is on, but the semantic packages are missing ({err}). "
              "Install requirements-semantic.txt. Continuing without it.")
    return _engine
