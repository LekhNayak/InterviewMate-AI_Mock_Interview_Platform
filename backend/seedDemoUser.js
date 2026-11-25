// Creates the account opened by the sign-in page's demo button (POST /api/user/demo-login).
//   DEMO_EMAIL     required, also read by the API
//   DEMO_PASSWORD  optional, a random one is set when missing
// Safe to re-run: it resets the password of an existing account.
require("dotenv").config();
const crypto = require("crypto");
const mongoose = require("mongoose");
const User = require("./src/models/user.model");

(async () => {
    try {
        const email = (process.env.DEMO_EMAIL || "").trim().toLowerCase();
        if (!email) throw new Error("Set DEMO_EMAIL in .env first");
        const password = process.env.DEMO_PASSWORD || crypto.randomBytes(18).toString("base64url");

        await mongoose.connect(process.env.MONGO_URI);
        console.log("MongoDB Connected");

        const existing = await User.findOne({ email }).select("+password");
        const user = existing || new User({ name: "Demo User", email });
        user.password = password; // pre('save') hook hashes it
        await user.save();

        console.log(existing ? `♻️  Demo user already existed, password reset (${email})` : `✅ Demo user created (${email})`);
        await mongoose.disconnect();
        process.exit(0);
    } catch (err) {
        console.error("❌ Error:", err.message);
        process.exit(1);
    }
})();
