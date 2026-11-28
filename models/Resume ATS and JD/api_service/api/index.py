"""Vercel entry point. Vercel serves the WSGI `app` defined here.

vercel.json rewrites every request to /api/index and passes the path that was
asked for in the __path query parameter, because the Python runtime hands the
app the rewritten path (/api/index) rather than the original one. RestorePath
puts the original path back before Flask routes the request.
"""
import sys
from pathlib import Path
from urllib.parse import parse_qsl, urlencode

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from main import app  # noqa: E402

PATH_PARAM = "__path"


class RestorePath:
    def __init__(self, wsgi_app):
        self.wsgi_app = wsgi_app

    def __call__(self, environ, start_response):
        pairs = parse_qsl(environ.get("QUERY_STRING", ""), keep_blank_values=True)
        original = [value for key, value in pairs if key == PATH_PARAM]
        if original:
            environ["PATH_INFO"] = "/" + original[0].lstrip("/")
            environ["QUERY_STRING"] = urlencode([(k, v) for k, v in pairs if k != PATH_PARAM])
        return self.wsgi_app(environ, start_response)


app.wsgi_app = RestorePath(app.wsgi_app)
