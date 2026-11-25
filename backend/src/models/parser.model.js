const mongoose = require('mongoose');
const validator = require('validator');

const parsedResumeSchema = new mongoose.Schema({
    pdfUrl: {
        type: String,
        validate: {
            validator: (value) => !value || validator.isURL(value),
            message: 'Invalid PDF URL'
        }
    },
    userId: { type: mongoose.Types.ObjectId, ref: 'User', required: true },
    title: { type: String, required: true },
    header: {
        name: { type: String, default: '' },
        phone: { type: String, default: '' },
        email: { type: String, default: '' },
        github: { type: String }
    },
    objective: String,
    education: [
        { institution: String, degree: String, duration: String, score: String },
    ],
    skills: {
        languages: [String],
        frameworks: [String],
        other: [String],
    },
    projects: [
        {
            title: String,
            duration: String,
            tech: String,
            event: String,
            points: [String],
        },
    ],
    activities: [String],
});

module.exports = mongoose.model("ParsedResume", parsedResumeSchema);
