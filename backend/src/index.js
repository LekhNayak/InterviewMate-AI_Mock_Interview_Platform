require("dotenv").config();
const PORT = process.env.PORT || 5000;
const colors = require("colors");
const cors = require("cors");
const express = require("express");
const cookieParser = require("cookie-parser");
const { connect } = require("../src/config/db");

// Routes
const userRouter = require("../src/routes/user.routes");
const parserRouter = require("./routes/parser.routes");
const jdRouter = require("../src/routes/jd.routes");
const companyRoutes = require("../src/routes/company.routes");
const atsRouter = require('./routes/ats.routes');
const interviewRouter = require('./routes/interview.routes');
const jobRoutes = require("../src/routes/job.routes");

const app = express();

// Middleware
app.use(express.json());
app.use(
    cors({
        origin: ["http://localhost:8080", "https://inter-view-mate.vercel.app", "https://efos-hackathon-interview-mate.vercel.app", "https://interviewmate.lekh.online"],
        credentials: true,
        methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization"],
    })
);
app.use(cookieParser());

app.use((req, res, next) => {
    console.log("Incoming:", req.method, req.url);
    next();
});

// Every API route reads MongoDB. Waiting here also covers Vercel, where a cold
// instance has no connection yet when its first request arrives.
app.use("/api", async (req, res, next) => {
    try {
        await connect();
        next();
    } catch (err) {
        console.error("Database connection failed:", err.message);
        res.status(503).json({ success: false, message: "Database unavailable. Try again shortly." });
    }
});

// API Routes
app.use("/api/user", userRouter);
app.use("/api/parser", parserRouter);
app.use("/api/jd", jdRouter);
app.use("/api/companies", companyRoutes);
app.use("/api/ats", atsRouter);
app.use("/api/interview", interviewRouter);
app.use("/api/jobs", jobRoutes);
// Health check — answers even when the DB is down, and reports its state.
// It tries to connect first, because a fresh Vercel instance has no connection yet.
app.get("/health", async (req, res) => {
    await connect().catch(() => {});
    const states = ["disconnected", "connected", "connecting", "disconnecting"];
    res.json({
        server: "up",
        db: states[require("mongoose").connection.readyState] || "unknown",
    });
});

// Errors raised before a handler runs (bad upload, invalid JSON) answer as JSON.
app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status = err.name === "MulterError" ? 400 : err.status || err.statusCode || 500;
    if (status >= 500) console.error("Unhandled error:", err);
    const message = status >= 500 ? "Internal Server Error" : err.message;
    res.status(status).json({ success: false, message, error: message });
});

if (!process.env.SERVICE_TOKEN_SECRET) {
    console.log("⚠️  SERVICE_TOKEN_SECRET is not set: the interview, emotion and ATS services accept requests without a login".yellow);
}

// `node src/index.js` (local, Docker) starts a server. Vercel imports this file
// and serves the exported app itself.
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`🚀 Server running on port ${PORT}`.magenta);
    });

    // Connect early to report the result. API requests also wait for it.
    connect()
        .then(() => console.log("✅ Connected to database".cyan))
        .catch((err) => {
            console.log("❌ Database connection failed".red, err.message);
            console.log("⚠️  Server is still up; API routes retry the connection on each request".yellow);
        });
}

module.exports = app;
