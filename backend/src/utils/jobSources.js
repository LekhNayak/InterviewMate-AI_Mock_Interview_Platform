const axios = require("axios");

// Job listings from two providers behind one shape:
//   { title, company, location, description, url, source, postedAt }
//
// SerpApi (Google for Jobs) is the main source: on-site and remote jobs from
// LinkedIn, Naukri, Indeed, Shine and company sites, with full descriptions.
// Himalayas is the fallback: free and independent of Google, but remote jobs only.
//
// Each page comes with an opaque cursor for the next one. The cursor records which
// provider answered, so "load more" keeps using the same provider.

const encodeCursor = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");

const decodeCursor = (cursor) => {
    if (!cursor) return null;
    try {
        const value = JSON.parse(Buffer.from(String(cursor), "base64url").toString("utf8"));
        return value && (value.p === "serpapi" || value.p === "himalayas") ? value : null;
    } catch {
        return null;
    }
};

const htmlToText = (html) =>
    String(html || "")
        .replace(/<(br|\/p|\/li|\/h\d)\s*\/?>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&#39;|&apos;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/[ \t]+/g, " ")
        .replace(/\n\s*\n+/g, "\n\n")
        .trim();

class ProviderError extends Error {
    constructor(provider, message, { quota = false } = {}) {
        super(`${provider}: ${message}`);
        this.provider = provider;
        this.quota = quota;
    }
}

// --- SerpApi: Google for Jobs ---

const searchSerpApi = async ({ role, location, token }) => {
    const key = (process.env.SERPAPI_KEY || "").trim();
    if (!key) throw new ProviderError("serpapi", "SERPAPI_KEY is not set");

    const params = {
        engine: "google_jobs",
        q: role,
        location: location || "India",
        gl: "in",
        hl: "en",
        api_key: key,
    };
    if (token) params.next_page_token = token;

    let data;
    try {
        ({ data } = await axios.get("https://serpapi.com/search.json", { params, timeout: 30000 }));
    } catch (err) {
        const status = err.response?.status;
        const message = err.response?.data?.error || err.message;
        throw new ProviderError("serpapi", message, { quota: status === 429 || /run out of searches/i.test(message) });
    }

    // "Google hasn't returned any results" is how SerpApi reports an empty search.
    if (data.error && !/hasn't returned any results/i.test(data.error)) {
        throw new ProviderError("serpapi", data.error, { quota: /run out of searches/i.test(data.error) });
    }

    const jobs = (data.jobs_results || []).map((job) => ({
        title: job.title,
        company: job.company_name || "Unknown",
        location: job.location || "Not specified",
        description: job.description || "",
        url: job.apply_options?.[0]?.link || job.share_link || "",
        source: job.via ? job.via.replace(/^via\s+/i, "") : "Google Jobs",
        postedAt: job.detected_extensions?.posted_at || null,
    }));
    const next = data.serpapi_pagination?.next_page_token;
    return { jobs, provider: "serpapi", nextCursor: next ? encodeCursor({ p: "serpapi", t: next }) : null };
};

// --- Himalayas: remote jobs open to candidates in India ---

const HIMALAYAS_PAGE_SIZE = 20;

const searchHimalayas = async ({ role, page = 1 }) => {
    const headers = {};
    if (process.env.HIMALAYAS_API_KEY) headers.Authorization = `Bearer ${process.env.HIMALAYAS_API_KEY.trim()}`;

    let data;
    try {
        ({ data } = await axios.get("https://himalayas.app/jobs/api/search", {
            params: { q: role, country: "India", page },
            headers,
            timeout: 30000,
        }));
    } catch (err) {
        throw new ProviderError("himalayas", err.response?.data?.message || err.message, {
            quota: err.response?.status === 429,
        });
    }

    const jobs = (data.jobs || []).map((job) => ({
        title: job.title,
        company: job.companyName || "Unknown",
        location: job.locationRestrictions?.length ? `Remote (${job.locationRestrictions.join(", ")})` : "Remote",
        description: htmlToText(job.description || job.excerpt),
        // Himalayas' terms: keep the application link unchanged.
        url: job.applicationLink,
        source: "Himalayas",
        postedAt: job.pubDate ? new Date(job.pubDate * 1000).toISOString() : null,
    }));
    const total = Number(data.totalCount) || 0;
    const hasMore = jobs.length === HIMALAYAS_PAGE_SIZE && page * HIMALAYAS_PAGE_SIZE < total;
    return { jobs, provider: "himalayas", nextCursor: hasMore ? encodeCursor({ p: "himalayas", n: page + 1 }) : null };
};

/**
 * One page of jobs. Without a cursor it starts with SerpApi and falls back to
 * Himalayas when SerpApi fails, is out of searches or finds nothing. With a
 * cursor it continues with the provider that cursor came from.
 */
const searchJobs = async ({ role, location, cursor }) => {
    const from = decodeCursor(cursor);
    if (from?.p === "serpapi") return searchSerpApi({ role, location, token: from.t });
    if (from?.p === "himalayas") return searchHimalayas({ role, page: from.n });

    try {
        const result = await searchSerpApi({ role, location });
        if (result.jobs.length) return result;
        console.warn("[jobs] SerpApi found nothing, trying Himalayas");
    } catch (err) {
        console.warn(`[jobs] ${err.message}; trying Himalayas`);
    }
    return searchHimalayas({ role, page: 1 });
};

module.exports = { searchJobs, ProviderError, htmlToText, decodeCursor };
