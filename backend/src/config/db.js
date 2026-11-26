const mongoose = require('mongoose');

let pending = null;

// Opens the connection once and shares it. On Vercel every request awaits this,
// so a cold instance connects on its first request and a warm one reuses the
// connection. A failed attempt is forgotten, so the next request tries again.
const connect = () => {
    if (!pending) {
        pending = mongoose
            .connect(process.env.MONGO_URI, {
                serverSelectionTimeoutMS: 10000,
                // Many short-lived instances each hold a pool; keep them small.
                maxPoolSize: 10,
            })
            .catch((err) => {
                pending = null;
                throw err;
            });
    }
    return pending;
};

module.exports = { connect };
