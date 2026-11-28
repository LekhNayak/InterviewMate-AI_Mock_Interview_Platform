"""Groq calls that must answer in a fixed JSON shape."""
import json
import os
from typing import Dict

from groq import BadRequestError

from groq_keys import call_groq


class AnalysisError(RuntimeError):
    """The language model could not produce a usable answer."""


def model_name() -> str:
    return os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")


def _reasoning_effort(model: str):
    # Reasoning models spend completion tokens thinking. Judging evidence needs
    # some reasoning, but the free tier counts every token against a per-minute cap.
    m = model.lower()
    if "gpt-oss" in m:
        return "low"
    if "qwen" in m:
        return "none"
    return None


def _parse(content: str) -> Dict:
    text = (content or "").strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}") + 1
        if start == -1 or end <= start:
            raise AnalysisError("The model did not answer with JSON")
        return json.loads(text[start:end])


def complete_json(system: str, user: str, schema_name: str, schema: Dict, max_tokens: int) -> Dict:
    model = model_name()
    extra = {}
    effort = _reasoning_effort(model)
    if effort:
        extra["reasoning_effort"] = effort

    def request(response_format):
        return call_groq(lambda client: client.chat.completions.create(
            model=model,
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
            temperature=0,
            seed=7,  # same input, same answer as far as the model allows
            max_tokens=max_tokens,
            response_format=response_format,
            **extra,
        ))

    try:
        response = request({"type": "json_schema",
                            "json_schema": {"name": schema_name, "schema": schema, "strict": True}})
    except BadRequestError as err:
        # Models without structured outputs, or an answer that broke the schema.
        print(f"WARNING: {model} refused the {schema_name} schema, using JSON mode: {err}")
        response = request({"type": "json_object"})

    choice = response.choices[0]
    if choice.finish_reason == "length":
        raise AnalysisError("The analysis was cut off. The resume or job description may be too long.")
    try:
        return _parse(choice.message.content)
    except (json.JSONDecodeError, AnalysisError) as err:
        raise AnalysisError(f"The model's answer could not be read: {err}") from err
