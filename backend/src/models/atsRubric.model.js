const mongoose = require('mongoose');

// The requirement rubric the ATS service extracted for a job description or a
// job role. Reusing it means every analysis of the same job is measured against
// the same requirements, so re-running an analysis does not move the score.
// The key includes the JD's last update, so editing a JD builds a new rubric.
const atsRubricSchema = new mongoose.Schema(
    {
        key: { type: String, required: true, unique: true },
        rubric: { type: mongoose.Schema.Types.Mixed, required: true },
    },
    { timestamps: true }
);

// Unused rubrics are dropped after 90 days.
atsRubricSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 90 * 24 * 3600 });

module.exports = mongoose.model('AtsRubric', atsRubricSchema);
