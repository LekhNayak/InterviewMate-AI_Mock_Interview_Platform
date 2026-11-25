const express = require("express");
const { getAllCompanies, addCompany } = require("../handlers/company.handler");
const { userAuth } = require('../middleware/auth.middleware');

const router = express.Router();

router.get("/", getAllCompanies);
router.post("/", userAuth, addCompany);

module.exports = router;
