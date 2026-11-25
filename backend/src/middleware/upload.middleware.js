const fs = require('fs');
const path = require('path');
const multer = require('multer');

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'tempUploads');

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
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: allowOnly(['application/pdf'], 'Only PDF files are supported'),
});

// Videos go through disk. The folder is not in the Docker image, so create it.
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
