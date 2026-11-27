const express = require("express");
const router = express.Router();
const axios = require("axios");
const { userAuth } = require("../middleware/auth.middleware");
const { escapeRegex } = require("../utils/escapeRegex");

// Match whole words, so "go" does not match "google" and "c" does not match "c++".
const mentions = (text, skill) =>
    new RegExp(`(^|[^a-z0-9+#.])${escapeRegex(skill)}($|[^a-z0-9+#])`).test(text);

// 🔥 JOB SEARCH ROUTE
router.post("/search", userAuth, async (req, res) => {
    try {
        const { role, location, apiPage = 1 } = req.body;
        const user = req.user;

        const skills = user.skills || [];

        const query = [role, ...skills].join(" ");

        const params = {
            keyword: query,
            page: String(apiPage),
            sort_by: "relevant",
            date_posted: "past_week",
        };

        if (location && location.trim()) {
            params.location = location.trim();
        }

        const response = await axios.get(
            "https://fresh-linkedin-scraper-api.p.rapidapi.com/api/v1/job/search",
            {
                params,
                headers: {
                    "x-rapidapi-key": process.env.RAPIDAPI_KEY,
                    "x-rapidapi-host":
                        "fresh-linkedin-scraper-api.p.rapidapi.com",
                },
                timeout: 30000,
            }
        );

        // The provider reports its own failures (for example LinkedIn rate-limiting
        // its scraper) as HTTP 2xx with success: false. Treating that as "no jobs"
        // would hide the problem, so pass it on as an error the page can show.
        if (response.data?.success === false) {
            console.error("Job search provider failed:", response.data.message);
            return res.status(503).json({
                success: false,
                message: "The job search service is busy right now. Try again in a few minutes.",
            });
        }

        const jobs = response.data?.data || [];

        // 🔥 Match scoring
        const processed = jobs.map((job) => {
            const desc = (job.description || "").toLowerCase();

            let score = 0;
            const matchedSkills = [];

            skills.forEach((skill) => {
                if (mentions(desc, skill.toLowerCase())) {
                    score++;
                    matchedSkills.push(skill);
                }
            });

            return {
                title: job.title,
                company: job.company?.name || "Unknown",
                location: job.location || "Remote",
                description: job.description,
                url: job.url,
                matchScore: skills.length
                    ? Math.round((score / skills.length) * 100)
                    : 0,
                matchedSkills,
            };
        });

        processed.sort((a, b) => b.matchScore - a.matchScore);

        // Filter by location client-side since the API doesn't enforce it strictly
        const filtered = location && location.trim()
            ? processed.filter((job) =>
                job.location.toLowerCase().includes(location.trim().toLowerCase())
              )
            : processed;

        // `fetched` counts jobs before the location filter, so the client can tell
        // "no matches in this batch" from "no more batches".
        res.json({ success: true, jobs: filtered, fetched: jobs.length });

    } catch (err) {
        console.error("Job search failed:", err.response?.status, err.response?.data || err.message);
        const status = err.response?.status;
        const message =
            status === 429 ? "The monthly job search limit has been reached. Try again later."
            : status === 401 || status === 403 ? "Job search is not set up: the RapidAPI key is missing or invalid."
            : err.code === "ECONNABORTED" ? "The job search service took too long to answer. Try again."
            : "Job fetch failed";
        res.status(status === 429 ? 429 : 502).json({ success: false, message });
    }
});

module.exports = router;