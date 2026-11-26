const Groq = require('groq-sdk');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// The free "on_demand" Groq tier caps a request at 8000 tokens per minute
// (x-ratelimit-limit-tokens), and max_tokens counts toward that budget alongside
// the prompt. Asking for too much gets the whole call rejected with a 413
// rate_limit_exceeded, so completion and input are budgeted to fit inside it:
//   ~4000 prompt (16k chars) + 3000 completion = ~7000, leaving margin.
const TPM_BUDGET = 8000;
const DEFAULT_MAX_TOKENS = 3000;

// Roughly 4 chars per token; keeps the prompt inside the remaining budget.
const MAX_INPUT_CHARS = 16000;

const truncateForBudget = (text) => {
    const s = String(text || '');
    if (s.length <= MAX_INPUT_CHARS) return s;
    return s.slice(0, MAX_INPUT_CHARS) + '\n\n[document truncated to fit AI token budget]';
};

/**
 * Pull a JSON object out of a model response.
 * Handles markdown fences and trailing prose; uses brace matching rather than
 * a greedy /{[\s\S]*}/ regex, which over-matches when the text contains braces.
 */
const extractJson = (raw) => {
    let s = String(raw || '').trim();

    // Strip ```json ... ``` fences if the model added them anyway.
    s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();

    try {
        return JSON.parse(s);
    } catch {
        // fall through to brace matching
    }

    const start = s.indexOf('{');
    if (start === -1) {
        throw new Error('AI response contained no JSON object');
    }

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < s.length; i++) {
        const ch = s[i];
        if (escaped) { escaped = false; continue; }
        if (ch === '\\') { escaped = true; continue; }
        if (ch === '"') { inString = !inString; continue; }
        if (inString) continue;

        if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) return JSON.parse(s.slice(start, i + 1));
        }
    }

    throw new Error('AI returned incomplete JSON (response was cut off)');
};

// Reasoning models spend completion tokens thinking before they answer. For
// copying text into fields, the least thinking each model allows is enough.
const minimalReasoning = (model) => {
    if (/gpt-oss/i.test(model)) return 'low';
    if (/qwen3/i.test(model)) return 'none';
    return undefined;
};

/**
 * Chat completion constrained to a JSON object, with truncation surfaced
 * as a readable error instead of a downstream parse crash.
 *
 * schema:          { name, schema } makes the model follow that JSON Schema exactly.
 *                  Models without structured outputs fall back to plain JSON mode.
 * minimalThinking: asks a reasoning model to think as little as it allows.
 */
const completeJson = async ({ system, user, maxTokens = DEFAULT_MAX_TOKENS, temperature = 0.2, schema, minimalThinking = false }) => {
    const model = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
    const request = (responseFormat) => groq.chat.completions.create({
        model,
        messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
        ],
        temperature,
        max_tokens: maxTokens,
        response_format: responseFormat,
        ...(minimalThinking && minimalReasoning(model) ? { reasoning_effort: minimalReasoning(model) } : {}),
    });

    let completion;
    if (schema) {
        try {
            completion = await request({ type: 'json_schema', json_schema: { name: schema.name, schema: schema.schema, strict: true } });
        } catch (err) {
            if (err?.status !== 400) throw err;
            console.warn(`[groq] ${model} refused the JSON schema, using JSON mode: ${err.message}`);
        }
    }
    completion ??= await request({ type: 'json_object' });

    const choice = completion.choices[0];

    if (choice.finish_reason === 'length') {
        throw new Error(
            `AI response was truncated at ${maxTokens} tokens — the document is too long to parse in one pass`
        );
    }

    return extractJson(choice.message.content);
};

module.exports = {
    groq,
    completeJson,
    extractJson,
    truncateForBudget,
    DEFAULT_MAX_TOKENS,
    MAX_INPUT_CHARS,
    TPM_BUDGET,
};
