const mongoose = require('mongoose');
const validator = require('validator');
const { SECTION_KINDS, ENTRY_PRESETS, SOURCES } = require('../utils/resumeFormat');

// See utils/resumeFormat.js for the format. Handlers clean every value before it
// is stored, so these schemas only describe the shape.

const entrySchema = new mongoose.Schema(
    { id: String, title: String, subtitle: String, date: String, meta: String, bullets: [String] },
    { _id: false }
);

const sectionSchema = new mongoose.Schema(
    {
        id: { type: String, required: true },
        kind: { type: String, enum: SECTION_KINDS, required: true },
        preset: { type: String, enum: ENTRY_PRESETS },
        heading: { type: String, default: '' },
        hidden: { type: Boolean, default: false },
        text: String,
        entries: { type: [entrySchema], default: undefined },
        groups: { type: [{ _id: false, id: String, label: String, items: [String] }], default: undefined },
        items: { type: [String], default: undefined },
    },
    { _id: false }
);

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
    // Where the resume came from, and the uploaded file's name.
    source: { type: String, enum: SOURCES },
    sourceName: String,
    header: {
        name: { type: String, default: '' },
        phone: { type: String, default: '' },
        email: { type: String, default: '' },
        location: { type: String, default: '' },
        links: { type: [{ _id: false, label: String, url: String }], default: undefined },
        github: { type: String }, // old format; became a link
    },
    sections: { type: [sectionSchema], default: undefined },
    layout: { fontSize: Number, lineHeight: Number, margin: Number, sectionGap: Number, entryGap: Number },
    // What the importer found in the uploaded file. Set by the server only.
    importReport: mongoose.Schema.Types.Mixed,

    // Old fixed format, read and converted by resumeFormat.toClient().
    objective: String,
    education: { type: [{ institution: String, degree: String, duration: String, score: String }], default: undefined },
    skills: {
        languages: { type: [String], default: undefined },
        frameworks: { type: [String], default: undefined },
        other: { type: [String], default: undefined },
    },
    projects: {
        type: [{ title: String, duration: String, tech: String, event: String, points: [String] }],
        default: undefined,
    },
    activities: { type: [String], default: undefined },
});

module.exports = mongoose.model("ParsedResume", parsedResumeSchema);
