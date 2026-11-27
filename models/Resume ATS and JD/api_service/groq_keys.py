"""Groq calls with several API keys.

Keys are read from GROQ_API_KEY, then GROQ_API_KEY_2, GROQ_API_KEY_3 and so on,
in number order. Add a key by adding the next number; there is no upper limit
and gaps are fine.

When a key is rejected or out of quota, the call is retried with the next key,
and that key stays in use until it fails too. Other errors (a bad request, a
timeout, Groq being down) are not about the key and are raised at once.

The same file is in each Python service that calls Groq; keep the copies equal.
"""
import os
import re
import threading
from typing import Callable, Dict, List, Optional, Tuple, TypeVar

from groq import APIStatusError, Groq

T = TypeVar("T")

_KEY_NAME = re.compile(r"^GROQ_API_KEY(?:_(\d+))?$")

_lock = threading.Lock()
_current = 0  # Position of the key that worked last.
_clients: Dict[Tuple[str, int, Optional[float]], Groq] = {}


def api_keys() -> List[Tuple[str, str]]:
    """(variable name, key) pairs in number order, without empty or repeated keys."""
    found = []
    for name, value in os.environ.items():
        match = _KEY_NAME.match(name.upper())
        if match and value.strip():
            found.append((int(match.group(1) or 1), name.upper(), value.strip()))
    found.sort()
    keys, seen = [], set()
    for _, name, key in found:
        if key not in seen:
            seen.add(key)
            keys.append((name, key))
    return keys


def _is_key_problem(err: Exception) -> bool:
    # Invalid or revoked (401), no access (403), rate or quota limit (429, or 413
    # when a request is over the per-minute token limit), or a restricted organization.
    if not isinstance(err, APIStatusError):
        return False
    details = str(err)
    if err.status_code in (401, 403, 429):
        return True
    if err.status_code == 413 and "rate_limit" in details:
        return True
    return "organization_restricted" in details


def _client(key: str, max_retries: int, timeout: Optional[float]) -> Groq:
    cache_key = (key, max_retries, timeout)
    if cache_key not in _clients:
        kwargs = {"timeout": timeout} if timeout else {}
        _clients[cache_key] = Groq(api_key=key, max_retries=max_retries, **kwargs)
    return _clients[cache_key]


def call_groq(fn: Callable[[Groq], T], timeout: Optional[float] = None) -> T:
    """Run fn(client) with the first key that works.

    Only the last key left to try uses the SDK's own retries; the others move on
    at once, since another key is faster than waiting out a rate limit.
    """
    global _current
    keys = api_keys()
    if not keys:
        raise RuntimeError("Missing GROQ_API_KEY in .env")

    start = _current % len(keys)
    for step in range(len(keys)):
        index = (start + step) % len(keys)
        is_last = step == len(keys) - 1
        name, key = keys[index]
        try:
            result = fn(_client(key, 2 if is_last else 0, timeout))
        except Exception as err:
            if not _is_key_problem(err):
                with _lock:
                    _current = index  # The key works; the request itself failed.
                raise
            if is_last:
                raise
            next_name = keys[(index + 1) % len(keys)][0]
            print(f"WARNING: Groq {name} failed ({err.status_code}), trying {next_name}")
            continue
        with _lock:
            _current = index
        return result
    raise RuntimeError("unreachable")
