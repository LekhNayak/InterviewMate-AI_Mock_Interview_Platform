const User = require('../models/user.model');
const jwt = require('jsonwebtoken');

const userAuth = async (req, res, next) => {
    try {
        const { token } = req.cookies;

        // NOTE: every early exit must `return` — without it execution fell
        // through to jwt.verify(undefined), threw, and the catch tried to
        // respond a second time (ERR_HTTP_HEADERS_SENT).
        if (!token) {
            return res.status(401).json({
                success: false,
                message: 'Unauthorized access — no session cookie',
            });
        }

        let decoded;
        try {
            decoded = jwt.verify(token, process.env.SECRET_KEY);
        } catch (err) {
            // Expired or tampered token is an auth failure (401), not a 400.
            return res.status(401).json({
                success: false,
                message:
                    err.name === 'TokenExpiredError'
                        ? 'Session expired — please log in again'
                        : 'Invalid session token',
            });
        }

        const { _id } = decoded;
        if (!_id) {
            return res.status(401).json({ success: false, message: 'Invalid session token' });
        }

        const user = await User.findById(_id);
        if (!user) {
            return res.status(401).json({ success: false, message: 'User no longer exists' });
        }

        req.user = user;
        return next();
    } catch (err) {
        // Only genuine server-side faults reach here.
        console.error('userAuth error:', err);
        return res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
};

module.exports = {
    userAuth
};
