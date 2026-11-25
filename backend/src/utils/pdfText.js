const pdfParse = require('pdf-parse');

/**
 * Extract the text of a PDF.
 *
 * pdf-parse ships pdf.js 1.10, which clones its input with `new Buffer(...)`.
 * For files under about 4 KB Node serves that clone from a shared memory pool,
 * and pdf.js then reads the pool from its start: it fails, or returns the text
 * of a previously uploaded file. A plain Uint8Array owns its memory.
 */
const extractPdfText = async (buffer) => {
    const { text } = await pdfParse(new Uint8Array(buffer));
    return text;
};

module.exports = { extractPdfText };
