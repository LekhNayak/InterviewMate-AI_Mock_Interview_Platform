const ParsedResume = require("../models/parser.model");
const { uploadBuffer } = require("../config/cloudinary");
const { extractPdfText } = require("../utils/pdfText");
const { importResume } = require("../utils/resumeImport");
const {
    cleanHeader, cleanSections, cleanLayout, toClient, resumeToText, LEGACY_FIELDS,
} = require("../utils/resumeFormat");

// Fields a client may set, cleaned. The owner, the PDF URL, the source and the
// import report are set by the server: the owner decides access, and the API
// downloads whatever pdfUrl points to.
const editable = (body = {}) => {
    const out = {};
    if (typeof body.title === "string" && body.title.trim()) out.title = body.title.trim().slice(0, 200);
    if (body.header !== undefined) out.header = cleanHeader(body.header);
    if (body.sections !== undefined) out.sections = cleanSections(body.sections);
    if (body.layout !== undefined) out.layout = cleanLayout(body.layout);
    return out;
};

const titleFromFile = (name) => name.replace(/\.(pdf|tex)$/i, "").replace(/_/g, " ").trim();

// Upload a PDF or .tex resume, read it into sections, and save it.
const parseResume = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, error: "No file uploaded" });

        const fileName = req.file.originalname.slice(0, 200);
        const isTex = /\.tex$/i.test(fileName);
        const content = isTex ? req.file.buffer.toString("utf8") : await extractPdfText(req.file.buffer);
        if (!content.trim()) {
            return res.status(400).json({
                success: false,
                error: "No text was found in this file. A scanned PDF is an image and cannot be read.",
            });
        }

        const { resume, report } = await importResume({ kind: isTex ? "tex" : "pdf", content, fileName });

        // Stored after the import worked, so a failed import leaves no file behind.
        // The Resume Analyzer reads this original PDF.
        let pdfUrl;
        if (!isTex) {
            const publicId = `${Date.now()}_${fileName.replace(/\.[^.]+$/, "").replace(/[^\w-]+/g, "_")}`;
            pdfUrl = await uploadBuffer(req.file.buffer, "resumes", publicId);
        }

        const title = (typeof req.body.title === "string" && req.body.title.trim()) || titleFromFile(fileName) || "Imported Resume";
        const doc = await new ParsedResume({
            ...resume,
            title: title.slice(0, 200),
            layout: cleanLayout(),
            userId: req.user._id,
            pdfUrl,
            source: isTex ? "tex" : "pdf",
            sourceName: fileName,
            importReport: report,
        }).save();

        const saved = toClient(doc);
        res.status(201).json({ success: true, resume: saved, report, resumeText: resumeToText(saved) });
    } catch (error) {
        console.error("❌ Error parsing resume:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
};

const createResume = async (req, res) => {
    try {
        const doc = await new ParsedResume({
            title: "Untitled Resume",
            ...editable(req.body),
            source: "scratch",
            userId: req.user._id,
        }).save();
        res.status(201).json({ success: true, resume: toClient(doc) });
    } catch (err) {
        console.error("Error creating resume:", err.message);
        const status = err.name === 'ValidationError' ? 400 : 500;
        res.status(status).json({ success: false, message: "Failed to create resume", error: err.message });
    }
};

const getAllResumes = async (req, res) => {
    try {
        const resumes = await ParsedResume.find({ userId: req.user._id }).lean();
        res.json({ success: true, resumes: resumes.map(toClient) });
    } catch (error) {
        console.error("❌ Get All Resumes Error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
};

const updateResume = async (req, res) => {
    try {
        const fields = editable(req.body);
        if (!Object.keys(fields).length) {
            return res.status(400).json({ success: false, error: "Nothing to update" });
        }

        // Saving sections replaces the old fixed fields for good.
        const update = { $set: fields };
        if (fields.sections) update.$unset = Object.fromEntries(LEGACY_FIELDS.map((f) => [f, 1]));

        const updatedResume = await ParsedResume.findOneAndUpdate(
            { _id: req.params.id, userId: req.user._id },
            update,
            { new: true, runValidators: true }
        );

        if (!updatedResume) {
            return res.status(404).json({ success: false, message: "Resume not found" });
        }

        res.json({ success: true, updatedResume: toClient(updatedResume) });
    } catch (error) {
        console.error("❌ Error updating resume:", error.message);
        const status = ['ValidationError', 'CastError'].includes(error.name) ? 400 : 500;
        res.status(status).json({ success: false, error: error.message });
    }
};

const deleteResume = async (req, res) => {
    try {
        const deleted = await ParsedResume.findOneAndDelete({ _id: req.params.id, userId: req.user._id });

        if (!deleted)
            return res.status(404).json({ success: false, message: "Resume not found" });

        res.json({ success: true, message: "Resume deleted" });
    } catch (error) {
        console.error("❌ Delete Resume Error:", error.message);
        res.status(500).json({ success: false, error: error.message });
    }
};

module.exports = { parseResume, createResume, getAllResumes, updateResume, deleteResume };
