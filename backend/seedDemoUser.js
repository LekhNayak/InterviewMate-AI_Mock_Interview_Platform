// Seeds the demo account used by the login screen's "Demo Account" button.
// Safe to re-run: resets the password if the user already exists.
require("dotenv").config();
const mongoose = require("mongoose");
const User = require("./src/models/user.model");

const DEMO = {
    name: "Lekh Nayak",
    email: "lekhnayakwork@gmail.com",
    password: "123456",
};

(async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log("MongoDB Connected");

        let user = await User.findOne({ email: DEMO.email }).select("+password");

        if (user) {
            user.password = DEMO.password; // pre('save') hook re-hashes
            await user.save();
            console.log(`♻️  Demo user already existed — password reset (${DEMO.email})`);
        } else {
            user = await new User(DEMO).save();
            console.log(`✅ Demo user created: ${DEMO.email} / ${DEMO.password}`);
        }

        console.log(`   _id: ${user._id}`);
        await mongoose.disconnect();
        process.exit(0);
    } catch (err) {
        console.error("❌ Error:", err.message);
        process.exit(1);
    }
})();
