const ATS = require('../models/ats.model');
const AtsRubric = require('../models/atsRubric.model');
const JobDescription = require('../models/jd.model');
const ParsedResume = require('../models/parser.model');
const { canReadJd, jdToText } = require('../utils/jdText');
const { extractPdfText } = require('../utils/pdfText');
const axios = require('axios');
const crypto = require('crypto');
const FormData = require('form-data');
const { signServiceToken } = require('../utils/serviceToken');

const STYLES = ['auto', 'balanced', 'keyword', 'skills', 'experienced', 'entry'];
const RUBRIC_VERSION = 1; // matches RUBRIC_VERSION in the ATS service
const REPORT_VERSION = 2; // matches VERSION in the ATS service's ats_core/engine.py

/**
 * The job text the ATS reads. The original PDF has the posting's own wording and
 * its required / preferred sections, which the parsed summary merges into one
 * skills list, so it is used when it can be read.
 */
async function jdSourceText(job) {
    const summary = jdToText(job);
    if (!job.url) return summary;
    try {
        const res = await axios.get(job.url, { responseType: 'arraybuffer', timeout: 15000 });
        const raw = (await extractPdfText(Buffer.from(res.data))).replace(/\n{3,}/g, '\n\n').trim();
        if (raw.length < 200) return summary;
        // The PDF usually names the job itself; adding it again would make its words look like repeated keywords.
        const named = job.title && raw.toLowerCase().includes(job.title.toLowerCase());
        return named ? raw : `Job Title: ${job.title}\nCompany: ${job.company}\n\n${raw}`;
    } catch (err) {
        console.warn('[ATS] could not read the JD PDF, using the summary:', err.message);
        return summary;
    }
}

const rubricKey = (jdId, job, jobRole) =>
    jdId
        ? `jd:${jdId}:${new Date(job.updatedAt || job.createdAt || 0).getTime()}`
        : `role:${jobRole.trim().toLowerCase().replace(/\s+/g, ' ')}`;

async function findRubric(key) {
    const doc = await AtsRubric.findOne({ key }).lean().catch(() => null);
    return doc?.rubric?.version === RUBRIC_VERSION ? doc.rubric : null;
}

function saveRubric(key, rubric) {
    if (!rubric) return;
    AtsRubric.updateOne({ key }, { $set: { rubric } }, { upsert: true })
        .catch((err) => console.warn('[ATS] could not store the rubric:', err.message));
}

async function callMLService({ jdText, jobRole, style, rubric }, pdfUrl, userId) {
    const pdfRes = await axios.get(pdfUrl, { responseType: 'arraybuffer', timeout: 20000 });
    const form = new FormData();
    if (jdText) form.append('jd_text', jdText);
    if (jobRole) form.append('job_role', jobRole);
    if (style && style !== 'auto') form.append('style', style);
    if (rubric) form.append('rubric', JSON.stringify(rubric));
    form.append('file', Buffer.from(pdfRes.data), { filename: 'resume.pdf', contentType: 'application/pdf' });

    // The ATS service is public when the API runs on Vercel, so it gets the same
    // kind of token the browser sends to the interview and emotion services.
    const token = signServiceToken(userId, '5m');
    const headers = form.getHeaders(token ? { Authorization: `Bearer ${token}` } : {});

    try {
        const mlResponse = await axios.post(`${process.env.ML_SERVER}/api/analyze`, form, {
            headers,
            timeout: 75000,
            maxBodyLength: Infinity,
        });
        return mlResponse.data;
    } catch (err) {
        const body = err.response?.data;
        console.error('[ATS] ML service error:', err.response?.status, typeof body === 'object' ? JSON.stringify(body) : body ?? err.message);
        // The service's own message ("No text could be read from this PDF...") is meant for the user.
        const error = new Error(body?.error || 'The ATS service is not answering. Try again in a minute.');
        error.status = err.response?.status === 422 ? 422 : 502;
        throw error;
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

/** The stored record: the full report, plus the older summary fields filled from it. */
const reportFields = (data) => {
    const { rubric, ...report } = data; // the rubric is stored once, in AtsRubric
    const insights = report.insights || {};
    const met = (report.requirements || []).filter((r) => r.status === 'met');
    return {
        score: report.score,
        verdict: report.verdict,
        style: report.style,
        report,
        jdMatch: `${report.score}%`,
        localAtsScore: report.score,
        missingKeywords: (report.keywords || []).filter((k) => !k.found).map((k) => k.term),
        profileSummary: insights.summary || '',
        technicalSkillsMatch: met.filter((r) => r.category !== 'soft_skill').map((r) => r.label),
        softSkillsMatch: met.filter((r) => r.category === 'soft_skill').map((r) => r.label),
        experienceAlignment: report.candidate?.years_evidence || '',
        improvementSuggestions: (insights.suggestions || []).map((s) => `${s.title}: ${s.detail}`),
        projectsAnalysis: insights.projects_analysis || '',
        overallComment: insights.verdict || '',
    };
};

const pickStyle = (style) => (STYLES.includes(style) ? style : 'auto');

const runAnalysis = async (req, res, { resumeId, jdId, jobRole }) => {
    const resume = await findUsableResume(req, res, resumeId);
    if (!resume) return;

    let job = null;
    if (jdId) {
        job = await JobDescription.findById(jdId);
        if (!job) return res.status(404).json({ success: false, error: 'Job Description not found.' });
        if (!canReadJd(job, req.user)) return res.status(403).json({ success: false, error: 'Access denied. Private JD.' });
    }

    const key = rubricKey(jdId, job, jobRole || '');
    const style = pickStyle(req.body.style);
    const inputKey = crypto.createHash('sha256')
        .update(JSON.stringify([RUBRIC_VERSION, key, resume.pdfUrl, style]))
        .digest('hex');

    const previous = await ATS.findOne({ user: req.user._id, inputKey, 'report.version': REPORT_VERSION }).sort({ createdAt: -1 });
    if (previous) {
        return res.status(200).json({ success: true, message: 'Same resume and job as before.', cached: true, ats: previous });
    }

    const [rubric, jdText] = await Promise.all([findRubric(key), job ? jdSourceText(job) : null]);
    const data = await callMLService({ jdText, jobRole: job ? null : jobRole, style, rubric }, resume.pdfUrl, req.user._id);
    if (data?.version !== REPORT_VERSION) {
        // An ATS service still running the old code answers in the old format.
        console.error('[ATS] the ATS service answered in an old format; restart or redeploy it');
        return res.status(502).json({
            success: false,
            error: 'The ATS service is running an older version. Restart it (or redeploy it), then try again.',
        });
    }
    if (!data.rubric_reused) saveRubric(key, data.rubric);

    const atsRecord = await ATS.create({
        user: req.user._id,
        resume: resumeId,
        inputKey,
        ...(job ? { jobDescription: jdId } : { jobRole }),
        ...reportFields(data),
    });

    res.status(201).json({ success: true, message: 'ATS analysis completed.', cached: false, ats: atsRecord });
};

const analyze = async (req, res) => {
    try {
        const { resumeId, jdId } = req.body;
        if (!resumeId || !jdId) {
            return res.status(400).json({ success: false, error: 'Both resumeId and jdId are required.' });
        }
        await runAnalysis(req, res, { resumeId, jdId });
    } catch (error) {
        console.error('❌ Error analyzing ATS results:', error.message);
        res.status(error.status || 500).json({ success: false, error: error.message });
    }
};

const quickAnalyze = async (req, res) => {
    try {
        const { resumeId } = req.body;
        const jobRole = String(req.body.jobRole || '').trim().slice(0, 120);
        if (!resumeId || !jobRole) {
            return res.status(400).json({ success: false, error: 'Both resumeId and jobRole are required.' });
        }
        await runAnalysis(req, res, { resumeId, jobRole });
    } catch (error) {
        console.error('❌ Error in quick ATS analysis:', error.message);
        res.status(error.status || 500).json({ success: false, error: error.message });
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

module.exports = {
    analyze,
    quickAnalyze,
    getAllByUser,
    getAllByResume,
    getAllByJD,
    getATSById,
};
