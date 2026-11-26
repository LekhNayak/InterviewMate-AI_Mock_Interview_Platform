"""Checks the short-lived token that the Express API issues to signed-in users.

The API signs it with SERVICE_TOKEN_SECRET. Set the same value here to require it.
Without the variable the check is off and every request is accepted.
"""
import os

from flask import g, jsonify, request

AUDIENCE = "interviewmate-services"


def install_auth(app, public_paths=(), public_prefixes=()):
    if not os.getenv("SERVICE_TOKEN_SECRET"):
        print("WARNING: SERVICE_TOKEN_SECRET is not set. Requests are accepted without a login.")

    @app.before_request
    def check_token():
        g.user_id = None
        secret = (os.getenv("SERVICE_TOKEN_SECRET") or "").strip()
        if not secret or request.method == "OPTIONS":
            return None
        if request.path in public_paths or request.path.startswith(tuple(public_prefixes)):
            return None

        import jwt

        scheme, _, token = request.headers.get("Authorization", "").partition(" ")
        if scheme.lower() != "bearer" or not token:
            return jsonify({"error": "Sign in to use this service"}), 401
        try:
            claims = jwt.decode(
                token, secret, algorithms=["HS256"], audience=AUDIENCE, options={"require": ["exp", "sub"]}
            )
        except jwt.PyJWTError:
            return jsonify({"error": "Invalid or expired token. Reload the page and try again."}), 401

        g.user_id = claims["sub"]
        return None
