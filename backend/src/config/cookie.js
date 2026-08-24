// Central auth-cookie options.
//
// Production: frontend (vercel / interviewmate.lekh.online) is a different SITE
// from the API, so the cookie must be SameSite=None, which browsers only accept
// alongside Secure — that requires HTTPS.
//
// Local dev: localhost:8080 -> localhost:8000 is cross-ORIGIN but same-SITE
// (port is not part of "site"), so SameSite=Lax is sent normally and lets us
// drop Secure over plain http. Note SameSite=None + Secure=false is rejected
// outright by browsers, so the two flags must always move together.
const isProd = process.env.NODE_ENV === 'production';

const cookieOptions = {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    path: '/',
};

// clearCookie only matches a cookie whose attributes line up with the original.
const clearCookieOptions = {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'none' : 'lax',
    path: '/',
};

const AUTH_COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days

module.exports = { cookieOptions, clearCookieOptions, AUTH_COOKIE_MAX_AGE };
