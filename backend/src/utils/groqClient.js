const Groq = require('groq-sdk');

// Groq calls with several API keys: GROQ_API_KEY, then GROQ_API_KEY_2,
// GROQ_API_KEY_3 and so on, in number order. Add a key by adding the next number;
// there is no upper limit and gaps are fine.
//
// When a key is rejected or out of quota, the call is retried with the next key,
// and that key stays in use until it fails too. Other errors (a bad request, a
// timeout, Groq being down) are not about the key and are thrown at once.

const KEY_NAME = /^GROQ_API_KEY(?:_(\d+))?$/;

const apiKeys = () => {
    const found = Object.entries(process.env)
        .map(([name, value]) => {
            const match = KEY_NAME.exec(name);
            const key = (value || '').trim();
            return match && key ? { name, order: Number(match[1] || 1), key } : null;
        })
        .filter(Boolean)
        .sort((a, b) => a.order - b.order);
    return found.filter((k, i) => found.findIndex((other) => other.key === k.key) === i);
};

// Problems with the key itself: invalid or revoked (401), no access (403),
// rate or quota limit (429, or 413 when a request is over the per-minute token
// limit), and an organization Groq has restricted.
const isKeyProblem = (err) => {
    const details = `${err?.message || ''} ${JSON.stringify(err?.error || '')}`;
    if ([401, 403, 429].includes(err?.status)) return true;
    if (err?.status === 413 && details.includes('rate_limit')) return true;
    return details.includes('organization_restricted');
};

const clients = new Map();
const clientFor = (key, maxRetries) => {
    const id = `${maxRetries}:${key}`;
    if (!clients.has(id)) clients.set(id, new Groq({ apiKey: key, maxRetries }));
    return clients.get(id);
};

let current = 0; // Position of the key that worked last.

/**
 * Run fn(client) with the first key that works.
 * Only the last key left to try uses the SDK's own retries; the others move on
 * at once, since another key is faster than waiting out a rate limit.
 */
const withGroq = async (fn) => {
    const keys = apiKeys();
    if (!keys.length) throw new Error('Missing GROQ_API_KEY in the API .env');

    const start = current % keys.length;
    for (let step = 0; step < keys.length; step++) {
        const index = (start + step) % keys.length;
        const isLast = step === keys.length - 1;
        try {
            const result = await fn(clientFor(keys[index].key, isLast ? 2 : 0));
            current = index;
            return result;
        } catch (err) {
            if (!isKeyProblem(err)) {
                current = index; // The key works; the request itself failed.
                throw err;
            }
            if (isLast) throw err;
            const next = keys[(index + 1) % keys.length].name;
            console.warn(`[groq] ${keys[index].name} failed (${err.status}), trying ${next}`);
        }
    }
};

const chatCompletion = (params) => withGroq((client) => client.chat.completions.create(params));

module.exports = { withGroq, chatCompletion, apiKeys };
