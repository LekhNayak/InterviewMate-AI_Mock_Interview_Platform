const express = require("express");
const { parseResume, createResume, getAllResumes, updateResume, deleteResume } = require("../handlers/parser.handler");
const { userAuth } = require('../middleware/auth.middleware');
const { uploadResume } = require('../middleware/upload.middleware');

const router = express.Router();

router.post("/parse", userAuth, uploadResume.single("file"), parseResume);
router.post("/create", userAuth, createResume);
router.get("/all", userAuth, getAllResumes);
router.put("/update/:id", userAuth, updateResume);
router.delete("/delete/:id", userAuth, deleteResume);

module.exports = router;
