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
            }
        );

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
        console.error(err.response?.data || err.message);
        res.status(500).json({
            success: false,
            message: "Job fetch failed",
        });
    }
});

module.exports = router;