const express = require("express");
const Groq = require("groq-sdk");
const { extractJson, truncateForBudget, DEFAULT_MAX_TOKENS } = require("../utils/groqJson");
const { extractPdfText } = require("../utils/pdfText");
const { saveResume, createResume, getAllResumes, updateResume, deleteResume } = require("../handlers/parser.handler");
const { userAuth } = require('../middleware/auth.middleware');
const { uploadPdf } = require('../middleware/upload.middleware');
const { uploadBuffer } = require('../config/cloudinary');

require("dotenv").config();

const router = express.Router();
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
router.post("/create", userAuth, createResume);
router.get("/all", userAuth, getAllResumes);
router.put("/update/:id", userAuth, updateResume);
router.delete("/delete/:id", userAuth, deleteResume);

router.post("/parse", userAuth, uploadPdf.single("file"), async (req, res) => {
  try {
    if (!req.file)
      return res.status(400).json({ success: false, error: "No file uploaded" });

    const safePublicId = `${Date.now()}_${req.file.originalname.replace(/\.[^.]+$/, '').replace(/\s+/g, '_')}`;
    const pdfUrl = await uploadBuffer(req.file.buffer, 'resumes', safePublicId);

    const text = truncateForBudget(await extractPdfText(req.file.buffer));

    const completion = await groq.chat.completions.create({
      model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
      messages: [
        {
          role: "system",
          content: "You are an AI Resume Parser. Always respond with valid JSON only — no markdown fences, no explanation outside the JSON.",
        },
        {
          role: "user",
          content: `Extract structured resume data from the following text and return a valid JSON object strictly matching this TypeScript interface:

interface Resume {
  title: string;
  header: { name: string; phone: string; email: string; github: string };
  objective: string;
  education: Array<{ institution: string; degree: string; duration: string; score: string; }>;
  skills: { languages: string[]; frameworks: string[]; other: string[]; };
  projects: Array<{ title: string; duration: string; tech: string; event: string; points: string[]; }>;
  activities: string[];
}

If any field is missing in the resume text, leave it empty.
Text:
${text}`,
        },
      ],
      temperature: 0.2,
      max_tokens: DEFAULT_MAX_TOKENS,
      response_format: { type: "json_object" },
    });

    if (completion.choices[0].finish_reason === "length") {
      throw new Error("AI response was truncated — this resume is too long to parse in one pass");
    }

    const parsedResume = extractJson(completion.choices[0].message.content);
    parsedResume.title = req.body.title || "Imported Resume";

    const resume = await saveResume(parsedResume, req.user._id, pdfUrl);
    res.status(201).json({ success: true, resume });

  } catch (error) {
    console.error("❌ Error parsing resume:", error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});



module.exports = router;
