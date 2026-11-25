const ParsedResume = require("../models/parser.model");

// Fields a client may set. The owner and the PDF URL are set by the server:
// the owner decides access, and the API downloads whatever pdfUrl points to.
const EDITABLE_FIELDS = ['title', 'header', 'objective', 'education', 'skills', 'projects', 'activities'];

const pickEditable = (body = {}) =>
    Object.fromEntries(EDITABLE_FIELDS.filter((f) => body[f] !== undefined).map((f) => [f, body[f]]));

const saveResume = (data, userId, pdfUrl) =>
    new ParsedResume({ ...pickEditable(data), userId, ...(pdfUrl ? { pdfUrl } : {}) }).save();

const createResume = async (req, res) => {
    try {
        const resume = await saveResume(req.body, req.user._id);
        res.status(201).json({ success: true, resume });
    } catch (err) {
        console.error("Error creating resume:", err.message);
        const status = err.name === 'ValidationError' ? 400 : 500;
        res.status(status).json({ success: false, message: "Failed to create resume", error: err.message });
    }
};

const getAllResumes = async (req, res) => {
    try {
        const resumes = await ParsedResume.find({ userId: req.user._id });
        res.json({ success: true, resumes });
    } catch (error) {
        console.error("❌ Get All Resumes Error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
};

const updateResume = async (req, res) => {
    try {
        const updatedResume = await ParsedResume.findOneAndUpdate(
            { _id: req.params.id, userId: req.user._id },
            { $set: pickEditable(req.body) },
            { new: true, runValidators: true }
        );

        if (!updatedResume) {
            return res.status(404).json({ success: false, message: "Resume not found" });
        }

        res.json({ success: true, updatedResume });
    } catch (error) {
        console.error("❌ Error updating resume:", error.message);
        const status = ['ValidationError', 'CastError'].includes(error.name) ? 400 : 500;
        res.status(status).json({ success: false, error: error.message });
    }
};

// ✅ Delete a parsed resume by _id (not id)
const deleteResume = async (req, res) => {
    try {
        const deleted = await ParsedResume.findOneAndDelete({ _id: req.params.id, userId: req.user._id });

        if (!deleted)
            return res.status(404).json({ success: false, message: "Resume not found" });

        res.json({ success: true, message: "Resume deleted", deleted });
    } catch (error) {
        console.error("❌ Delete Resume Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
};

module.exports = { saveResume, createResume, getAllResumes, updateResume, deleteResume };
