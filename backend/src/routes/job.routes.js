const express = require("express");
const router = express.Router();
const { userAuth } = require("../middleware/auth.middleware");
const { escapeRegex } = require("../utils/escapeRegex");
const { searchJobs } = require("../utils/jobSources");
const JobSearchCache = require("../models/jobSearchCache.model");

const CACHE_HOURS = 6;

// Match whole words, so "go" does not match "google" and "c" does not match "c++".
const mentions = (text, skill) =>
    new RegExp(`(^|[^a-z0-9+#.])${escapeRegex(skill)}($|[^a-z0-9+#])`).test(text);

const cacheKey = (role, location, cursor) =>
    JSON.stringify([role.toLowerCase(), location.toLowerCase(), cursor || ""]);

// The cache only saves quota; if MongoDB has a problem the search still runs.
const readCache = (key) => JobSearchCache.findOne({ key }).lean().catch(() => null);
const writeCache = (key, page) =>
    JobSearchCache.updateOne(
        { key },
        { $set: { ...page, expiresAt: new Date(Date.now() + CACHE_HOURS * 3600 * 1000) } },
        { upsert: true }
    ).catch((err) => console.warn("[jobs] cache write failed:", err.message));

/**
 * POST /api/jobs/search  { role, location?, cursor? }
 * Answers { success, jobs, nextCursor, provider }. Send nextCursor back to get
 * the next page; it is null when there are no more.
 * Only the role goes to the provider. The user's skills score each job locally.
 */
router.post("/search", userAuth, async (req, res) => {
    const role = String(req.body.role || "").trim().slice(0, 100);
    const location = String(req.body.location || "").trim().slice(0, 100);
    const cursor = req.body.cursor ? String(req.body.cursor).slice(0, 2000) : null;
    if (!role) return res.status(400).json({ success: false, message: "Enter a role" });

    try {
        const key = cacheKey(role, location, cursor);
        let page = await readCache(key);
        if (!page) {
            page = await searchJobs({ role, location, cursor });
            writeCache(key, { jobs: page.jobs, provider: page.provider, nextCursor: page.nextCursor });
        }

        const skills = req.user.skills || [];
        const jobs = page.jobs
            .map((job) => {
                const text = `${job.title} ${job.description}`.toLowerCase();
                const matchedSkills = skills.filter((skill) => mentions(text, skill.toLowerCase()));
                return {
                    ...job,
                    matchScore: skills.length ? Math.round((matchedSkills.length / skills.length) * 100) : 0,
                    matchedSkills,
                };
            })
            .sort((a, b) => b.matchScore - a.matchScore);

        res.json({ success: true, jobs, nextCursor: page.nextCursor || null, provider: page.provider });
    } catch (err) {
        console.error("[jobs] search failed:", err.message);
        const message = err.quota
            ? "The job search limit has been reached for now. Try again later."
            : "The job search service is not answering right now. Try again in a few minutes.";
        res.status(err.quota ? 429 : 503).json({ success: false, message });
    }
});

module.exports = router;
