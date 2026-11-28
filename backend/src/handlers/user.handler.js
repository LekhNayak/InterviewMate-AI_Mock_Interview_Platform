const crypto = require("crypto");
const User = require('../models/user.model');
const OTP = require('../models/otp.model');
const ParsedResume = require('../models/parser.model');
const JobDescription = require('../models/jd.model');
const ATS = require('../models/ats.model');
const Interview = require('../models/interview.model');
const sendEmail = require('../config/mailer');
const { validateSignUpData } = require('../utils/validate');
const { signServiceToken } = require('../utils/serviceToken');
const { cookieOptions, clearCookieOptions, AUTH_COOKIE_MAX_AGE } = require('../config/cookie');

const MAX_OTP_ATTEMPTS = 5;
const OTP_RESEND_MS = 60 * 1000;
const MIN_PASSWORD_LENGTH = 6;

// Only strings may reach a Mongo filter: an object such as {"$gt": ""} would be an operator.
const cleanEmail = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');

const demoEmail = () => cleanEmail(process.env.DEMO_EMAIL);
const isDemoUser = (user) => Boolean(demoEmail()) && user.email === demoEmail();

const publicUser = (user) => ({ _id: user._id, name: user.name, email: user.email });

const setSession = async (res, user) => {
    const token = await user.getJWT();
    res.cookie('token', token, { ...cookieOptions, maxAge: AUTH_COOKIE_MAX_AGE });
};

const requestOtp = async (req, res) => {
    try {
        const email = cleanEmail(req.body?.email);

        if (!email) return res.status(400).json({ success: false, message: "Email is required" });

        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ success: false, message: "User already exists with this email" });
        }

        const pending = await OTP.findOne({ email });
        if (pending && Date.now() - pending.createdAt.getTime() < OTP_RESEND_MS) {
            return res.status(429).json({ success: false, message: "A code was just sent. Wait a minute before asking for another." });
        }

        const otp = crypto.randomInt(100000, 1000000).toString();

        await sendEmail(email, "Your InterviewMate sign-up code", `Your code is: ${otp}\nIt expires in 5 minutes.`);
        await OTP.findOneAndUpdate({ email }, { otp, attempts: 0, createdAt: new Date() }, { upsert: true });

        res.status(200).json({ success: true, message: "OTP sent to email" });
    } catch (error) {
        console.error("OTP Request Error:", error.message);
        res.status(500).json({ success: false, message: "Failed to send OTP" });
    }
};

const signup = async (req, res) => {
    try {
        const { name, password, otp } = req.body || {};
        const email = cleanEmail(req.body?.email);

        try {
            validateSignUpData(req);
            if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
                throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters long`);
            }
        } catch (err) {
            return res.status(400).json({ success: false, message: err.message });
        }

        // Count the attempt before comparing, so parallel guesses cannot slip past the limit.
        const pending = await OTP.findOneAndUpdate({ email }, { $inc: { attempts: 1 } }, { new: true });
        if (pending && pending.attempts > MAX_OTP_ATTEMPTS) {
            return res.status(429).json({ success: false, message: "Too many wrong codes. Request a new one." });
        }
        if (!pending || pending.otp !== String(otp)) {
            return res.status(400).json({ success: false, message: "Invalid or expired OTP" });
        }

        const newUser = new User({ name, email, password });
        await newUser.save();
        await OTP.deleteOne({ email });
        await setSession(res, newUser);

        res.status(201).json({
            success: true,
            message: "User registered successfully",
            user: publicUser(newUser),
        });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(400).json({ success: false, message: "User already exists with this email" });
        }
        if (error.name === 'ValidationError') {
            return res.status(400).json({ success: false, message: Object.values(error.errors)[0].message });
        }
        console.error("Signup Error:", error.message);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

const login = async (req, res) => {
    try {
        const email = cleanEmail(req.body?.email);
        const { password } = req.body || {};

        if (!email || typeof password !== 'string' || !password) {
            return res.status(400).json({ success: false, message: 'Email and password are required' });
        }

        const user = await User.findOne({ email }).select('+password');
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found',
            });
        }

        const isMatch = await user.comparePassword(password);
        if (!isMatch) {
            return res.status(400).json({
                success: false,
                message: 'Password is incorrect',
            });
        }

        await setSession(res, user);

        return res.status(200).json({
            success: true,
            message: 'User logged in successfully',
            user: publicUser(user),
        });
    } catch (error) {
        console.error('Login Error:', error.message);
        return res.status(500).json({
            success: false,
            message: 'Internal Server Error',
        });
    }
};

// The demo account is named by DEMO_EMAIL and opened by the server, so no
// password has to be published in the frontend.
const demoStatus = async (req, res) => {
    try {
        const enabled = Boolean(demoEmail()) && Boolean(await User.exists({ email: demoEmail() }));
        res.json({ success: true, enabled });
    } catch (error) {
        console.error('Demo Status Error:', error.message);
        res.json({ success: true, enabled: false });
    }
};

const demoLogin = async (req, res) => {
    try {
        const user = demoEmail() ? await User.findOne({ email: demoEmail() }) : null;
        if (!user) {
            return res.status(404).json({ success: false, message: 'The demo account is not available' });
        }
        await setSession(res, user);
        res.json({ success: true, message: 'User logged in successfully', user: publicUser(user) });
    } catch (error) {
        console.error('Demo Login Error:', error.message);
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
};

// Short-lived token the browser sends to the interview service.
// `token` is null when SERVICE_TOKEN_SECRET is not set, and the service then
// accepts requests without one.
const serviceToken = (req, res) => {
    const expiresIn = 3 * 60 * 60;
    const token = signServiceToken(req.user._id, expiresIn);
    if (!token) return res.json({ success: true, token: null });
    res.json({ success: true, token, expiresIn });
};

const profile = async (req, res) => {
    try {
        const user = await User.findById(req.user._id)

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found',
            });
        }

        res.status(200).json({
            success: true,
            user,
        });
    } catch (error) {
        console.error('Profile Fetch Error:', error);
        res.status(500).json({
            success: false,
            message: 'Internal Server Error',
        });
    }
};



const updateProfile = async (req, res) => {
    try {
        const userId = req.user._id;
        const {
            name,
            age,
            gender,
            skills,
            interests,
            githubUrl,
            linkedinUrl,
            codeforcesUrl,
            leetcodeUrl,
        } = req.body;

        // ✅ Prepare allowed fields dynamically
        const allowedUpdates = {};
        if (name) allowedUpdates.name = name;
        if (age) allowedUpdates.age = age;
        if (gender) allowedUpdates.gender = gender;
        // These may be cleared, so an empty value is a valid update.
        if (skills !== undefined) allowedUpdates.skills = skills;
        if (interests !== undefined) allowedUpdates.interests = interests;
        if (githubUrl !== undefined) allowedUpdates.githubUrl = githubUrl;
        if (linkedinUrl !== undefined) allowedUpdates.linkedinUrl = linkedinUrl;
        if (codeforcesUrl !== undefined) allowedUpdates.codeforcesUrl = codeforcesUrl;
        if (leetcodeUrl !== undefined) allowedUpdates.leetcodeUrl = leetcodeUrl;

        if (Object.keys(allowedUpdates).length === 0) {
            return res.status(400).json({
                success: false,
                message: "No valid fields provided for update.",
            });
        }

        const updatedUser = await User.findByIdAndUpdate(
            userId,
            { $set: allowedUpdates },
            { new: true, runValidators: true, context: "query" }
        );

        if (!updatedUser) {
            return res.status(404).json({
                success: false,
                message: "User not found.",
            });
        }

        res.status(200).json({
            success: true,
            message: "Profile updated successfully",
            user: {
                _id: updatedUser._id,
                name: updatedUser.name,
                email: updatedUser.email,
                age: updatedUser.age,
                gender: updatedUser.gender,
                skills: updatedUser.skills,
                interests: updatedUser.interests,
                githubUrl: updatedUser.githubUrl,
                linkedinUrl: updatedUser.linkedinUrl,
                codeforcesUrl: updatedUser.codeforcesUrl,
                leetcodeUrl: updatedUser.leetcodeUrl,
                createdAt: updatedUser.createdAt,
                updatedAt: updatedUser.updatedAt,
            },
        });
    } catch (error) {
        if (error.name === 'ValidationError') {
            return res.status(400).json({ success: false, message: Object.values(error.errors)[0].message });
        }
        console.error("Update Profile Error:", error);
        res.status(500).json({
            success: false,
            message: "Internal Server Error",
        });
    }
};

const logout = async (req, res) => {
    try {
        res.clearCookie("token", clearCookieOptions);
        res.status(200).json({ success: true, message: "Logged out successfully" });
    } catch (error) {
        console.error("Logout Error:", error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

const deleteUser = async (req, res) => {
    try {
        if (isDemoUser(req.user)) {
            return res.status(403).json({ success: false, message: "The demo account cannot be deleted" });
        }

        const userId = req.user._id;
        await Promise.all([
            ParsedResume.deleteMany({ userId }),
            Interview.deleteMany({ userId }),
            ATS.deleteMany({ user: userId }),
            JobDescription.deleteMany({ uploadedBy: userId }),
        ]);
        await User.findByIdAndDelete(userId);

        res.clearCookie("token", clearCookieOptions);
        res.status(200).json({ success: true, message: "User deleted successfully" });
    } catch (error) {
        console.error("Delete User Error:", error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

const changePassword = async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body || {};

        if (isDemoUser(req.user)) {
            return res.status(403).json({ success: false, message: "The demo account's password cannot be changed" });
        }
        if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
            return res.status(400).json({ success: false, message: "Current and new password are required" });
        }
        if (newPassword.length < MIN_PASSWORD_LENGTH) {
            return res.status(400).json({ success: false, message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters long` });
        }

        const user = await User.findById(req.user._id).select("+password");
        if (!user) return res.status(404).json({ success: false, message: "User not found" });

        if (!(await user.comparePassword(currentPassword))) {
            return res.status(400).json({ success: false, message: "Current password incorrect" });
        }

        user.password = newPassword;
        await user.save();

        res.status(200).json({ success: true, message: "Password changed successfully" });
    } catch (error) {
        console.error("Change Password Error:", error.message);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};

module.exports = {
    signup,
    login,
    demoStatus,
    demoLogin,
    serviceToken,
    profile,
    updateProfile,
    requestOtp,
    logout,
    deleteUser,
    changePassword
};
