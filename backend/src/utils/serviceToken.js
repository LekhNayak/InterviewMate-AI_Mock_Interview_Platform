const jwt = require('jsonwebtoken');

// The interview, emotion and ATS services check this token with the same
// SERVICE_TOKEN_SECRET (see service_auth.py in each). Returns null when the
// secret is not set; the services then accept requests without a token.
const signServiceToken = (userId, expiresIn) => {
    const secret = process.env.SERVICE_TOKEN_SECRET;
    if (!secret) return null;
    return jwt.sign({ sub: String(userId) }, secret, { audience: 'interviewmate-services', expiresIn });
};

module.exports = { signServiceToken };
