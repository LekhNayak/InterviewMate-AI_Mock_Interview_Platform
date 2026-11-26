const fs = require('fs');
const os = require('os');
const path = require('path');
const multer = require('multer');

// The system temp folder, because Vercel can write only there.
const UPLOAD_DIR = path.join(os.tmpdir(), 'interviewmate-uploads');

// Vercel refuses request bodies over 4.5 MB before they reach the app. A lower
// limit here answers with a clear error instead, the same in every environment.
const MAX_PDF_BYTES = 4 * 1024 * 1024;

const VIDEO_TYPES = [
    'video/mp4',
    'video/quicktime', // .mov
    'video/x-msvideo', // .avi
    'video/x-matroska', // .mkv
    'video/webm', // .webm
];

const allowOnly = (types, message) => (req, file, cb) => {
    if (types.includes(file.mimetype)) return cb(null, true);
    const err = new Error(message);
    err.status = 400;
    cb(err, false);
};

// PDFs are small and are forwarded to Cloudinary, so they stay in memory.
const uploadPdf = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_PDF_BYTES },
    fileFilter: allowOnly(['application/pdf'], 'Only PDF files are supported'),
});

// Videos go through disk, so create the folder on first use.
const uploadVideo = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => {
            fs.mkdir(UPLOAD_DIR, { recursive: true }, (err) => cb(err, UPLOAD_DIR));
        },
        filename: (req, file, cb) => cb(null, `${Date.now()}-${path.basename(file.originalname)}`),
    }),
    fileFilter: allowOnly(VIDEO_TYPES, 'Only video files are supported'),
});

module.exports = { uploadPdf, uploadVideo };
