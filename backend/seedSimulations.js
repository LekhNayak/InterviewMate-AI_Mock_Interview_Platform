// Adds one public job description, owned by the demo account. Run seedDemoUser.js first.
require("dotenv").config();
const mongoose = require("mongoose");
const User = require("./src/models/user.model");
const JobDescription = require("./src/models/jd.model");

const jobs = [
    {
        company: "Northwind",
        title: "Backend Engineer",
        location: "Pune",
        jobType: "Hybrid",
        description: "Northwind builds routing software for city transit operators. You will own Node.js services that store vehicle positions and push updates to riders in real time.",
        requiredSkills: ["node.js", "express", "mongodb", "redis"],
        url: "https://example.com/jobs/backend-engineer.pdf",
    },
];

(async () => {
    try {
        const email = (process.env.DEMO_EMAIL || "").trim().toLowerCase();
        if (!email) throw new Error("Set DEMO_EMAIL in .env first");

        await mongoose.connect(process.env.MONGO_URI);
        console.log("MongoDB Connected");

        const owner = await User.findOne({ email });
        if (!owner) throw new Error("Demo user not found. Run seedDemoUser.js first");

        const added = await JobDescription.insertMany(jobs.map((job) => ({ ...job, uploadedBy: owner._id, isPublic: true })));
        console.log(`✅ Inserted ${added.length} job description(s)`);
        await mongoose.disconnect();
        process.exit(0);
    } catch (err) {
        console.error("❌ Error:", err.message);
        process.exit(1);
    }
})();
