"""Vercel entry point. Vercel serves the WSGI `app` defined here, and vercel.json
sends every path to it, so the routes stay /api/... as in local dev."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from interview_service import create_app  # noqa: E402

app = create_app()
