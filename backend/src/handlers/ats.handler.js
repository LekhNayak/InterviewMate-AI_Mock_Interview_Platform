const ATS = require('../models/ats.model');
const JobDescription = require('../models/jd.model');
const ParsedResume = require('../models/parser.model');
const { canReadJd, jdToText } = require('../utils/jdText');
const axios = require('axios');
const FormData = require('form-data');
const { signServiceToken } = require('../utils/serviceToken');

async function callMLService(jd_text, pdfUrl, userId) {
    const pdfRes = await axios.get(pdfUrl, { responseType: 'arraybuffer', timeout: 20000 });
    const pdfBuffer = Buffer.from(pdfRes.data);

    const form = new FormData();
    form.append('jd_text', jd_text);
    form.append('file', pdfBuffer, { filename: 'resume.pdf', contentType: 'application/pdf' });

    // The ATS service is public when the API runs on Vercel, so it gets the same
    // kind of token the browser sends to the interview and emotion services.
    const token = signServiceToken(userId, '5m');
    const headers = form.getHeaders(token ? { Authorization: `Bearer ${token}` } : {});

    try {
        const mlResponse = await axios.post(`${process.env.ML_SERVER}/api/analyze`, form, {
            headers,
            timeout: 60000,
        });
        return mlResponse.data;
    } catch (err) {
        const body = err.response?.data;
        const detail = typeof body === 'object' ? JSON.stringify(body) : String(body ?? err.message);
        console.error('[ATS] ML service error:', err.response?.status, detail);
        throw new Error(detail);
    }
}

// The user's own resume, or null. Also answers the request when it is unusable.
async function findUsableResume(req, res, resumeId) {
    const resume = await ParsedResume.findOne({ _id: resumeId, userId: req.user._id });
    if (!resume) {
        res.status(404).json({ success: false, error: 'Resume not found.' });
        return null;
    }
    if (!resume.pdfUrl) {
        res.status(400).json({ success: false, error: 'This resume has no PDF. Upload it as a PDF to analyze it.' });
        return null;
    }
    return resume;
}

const reportFields = (data) => {
    const g = data.Gemini_JSON || {};
    return {
        jdMatch: g['JD Match'] || '',
        missingKeywords: g['MissingKeywords'] || [],
        profileSummary: g['Profile Summary'] || '',
        technicalSkillsMatch: g['TechnicalSkillsMatch'] || [],
        softSkillsMatch: g['SoftSkillsMatch'] || [],
        experienceAlignment: g['ExperienceAlignment'] || '',
        improvementSuggestions: g['ImprovementSuggestions'] || [],
        projectsAnalysis: g['ProjectsAnalysis'] || '',
        overallComment: g['OverallComment'] || '',
        localAtsScore: data.local_ATS_score || 0,
    };
};

const analyze = async (req, res) => {
    try {
        const { resumeId, jdId } = req.body;

        if (!resumeId || !jdId) {
            return res.status(400).json({
                success: false,
                error: 'Both resumeId and jdId are required.',
            });
        }

        const job = await JobDescription.findById(jdId);
        if (!job) {
            return res.status(404).json({ success: false, error: 'Job Description not found.' });
        }
        if (!canReadJd(job, req.user)) {
            return res.status(403).json({ success: false, error: 'Access denied. Private JD.' });
        }

        const resume = await findUsableResume(req, res, resumeId);
        if (!resume) return;

        const data = await callMLService(jdToText(job), resume.pdfUrl, req.user._id);

        const atsRecord = await ATS.create({
            user: req.user._id,
            jobDescription: jdId,
            resume: resumeId,
            ...reportFields(data),
        });

        res.status(201).json({
            success: true,
            message: 'ATS analysis completed and stored successfully.',
            ats: atsRecord,
        });
    } catch (error) {
        console.error('❌ Error analyzing ATS results:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
};

const getAllByUser = async (req, res) => {
    try {
        const atsList = await ATS.find({ user: req.user._id })
            .populate('jobDescription', 'title company')
            .populate('resume', 'title pdfUrl')
            .sort({ createdAt: -1 });

        res.status(200).json({
            success: true,
            count: atsList.length,
            atsList,
        });
    } catch (error) {
        console.error('❌ Error fetching ATS records by user:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

const getAllByResume = async (req, res) => {
    try {
        const { resumeId } = req.params;
        const atsList = await ATS.find({ resume: resumeId, user: req.user._id })
            .populate('jobDescription', 'title company')
            .populate('user', 'name email')
            .sort({ createdAt: -1 });

        res.status(200).json({
            success: true,
            count: atsList.length,
            atsList,
        });
    } catch (error) {
        console.error('❌ Error fetching ATS by resume:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

const getAllByJD = async (req, res) => {
    try {
        const { jdId } = req.params;
        const atsList = await ATS.find({ jobDescription: jdId, user: req.user._id })
            .populate('resume', 'title pdfUrl')
            .populate('user', 'name email')
            .sort({ createdAt: -1 });

        res.status(200).json({
            success: true,
            count: atsList.length,
            atsList,
        });
    } catch (error) {
        console.error('❌ Error fetching ATS by JD:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

const getATSById = async (req, res) => {
    try {
        const { id } = req.params;
        const ats = await ATS.findOne({ _id: id, user: req.user._id })
            .populate('user', 'name email')
            .populate('resume', 'title pdfUrl')
            .populate('jobDescription', 'title company location');

        if (!ats) {
            return res.status(404).json({ success: false, error: 'ATS record not found' });
        }

        res.status(200).json({ success: true, ats });
    } catch (error) {
        console.error('❌ Error fetching ATS by ID:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

const quickAnalyze = async (req, res) => {
    try {
        const { resumeId, jobRole } = req.body;

        if (!resumeId || !jobRole) {
            return res.status(400).json({
                success: false,
                error: 'Both resumeId and jobRole are required.',
            });
        }

        const resume = await findUsableResume(req, res, resumeId);
        if (!resume) return;

        const jd_text = `Job Role: ${jobRole}\n\nThis position requires skills and experience relevant to the role of ${jobRole}. The candidate should demonstrate strong technical and soft skills aligned with this role.`;

        const data = await callMLService(jd_text, resume.pdfUrl, req.user._id);

        const atsRecord = await ATS.create({
            user: req.user._id,
            resume: resumeId,
            jobRole,
            ...reportFields(data),
        });

        res.status(201).json({
            success: true,
            message: 'Quick ATS analysis completed.',
            ats: atsRecord,
        });
    } catch (error) {
        console.error('❌ Error in quick ATS analysis:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
};

module.exports = {
    analyze,
    quickAnalyze,
    getAllByUser,
    getAllByResume,
    getAllByJD,
    getATSById,
};
