const mongoose = require("mongoose");

// Answers from the job providers, kept for 6 hours. A repeated search (the same
// role, location and page) is served from here and does not use the SerpApi
// monthly quota. MongoDB deletes each entry when `expiresAt` passes.
const jobSearchCacheSchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true },
    jobs: { type: Array, default: [] },
    provider: { type: String },
    nextCursor: { type: String, default: null },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
});

module.exports = mongoose.model("JobSearchCache", jobSearchCacheSchema);
