// Turns an uploaded resume (PDF text or LaTeX source) into the resume format,
// and reports how much of the file made it across.

const { completeJson, truncateForBudget, MAX_INPUT_CHARS, TPM_BUDGET } = require('./groqJson');
const { cleanHeader, cleanSections, resumeToText } = require('./resumeFormat');

const SYSTEM = 'You convert resumes into JSON. Respond with one JSON object only, no markdown and no explanation.';

const str = { type: 'string' };
const strings = { type: 'array', items: str };
const object = (properties) => ({ type: 'object', additionalProperties: false, required: Object.keys(properties), properties });

// Strict structured output: every section has every field, and the model
// leaves the ones its kind does not use empty.
const SCHEMA = {
    name: 'resume',
    schema: object({
        header: object({ name: str, email: str, phone: str, location: str, links: { type: 'array', items: object({ label: str, url: str }) } }),
        sections: {
            type: 'array',
            items: object({
                heading: str,
                kind: { type: 'string', enum: ['text', 'entries', 'skills', 'list'] },
                preset: { type: 'string', enum: ['experience', 'education', 'projects', 'custom', 'none'] },
                text: str,
                entries: { type: 'array', items: object({ title: str, subtitle: str, date: str, meta: str, bullets: strings }) },
                groups: { type: 'array', items: object({ label: str, items: strings }) },
                items: strings,
            }),
        },
    }),
};

const FORMAT = `Convert the resume into JSON with a "header" and a list of "sections".
Each section has a heading, a kind, and the field for that kind. Leave the other fields empty ("" or []).
- kind "entries" uses "entries": items with a name and usually dates (experience, education, projects, research, leadership, volunteering).
  Each entry: title, subtitle, date, meta, bullets.
  Experience: title = role, subtitle = company, meta = location.
  Education: title = institution, subtitle = degree, meta = grade or location.
  Projects: title = project name, subtitle = tech stack, meta = link or event.
  preset is "experience", "education" or "projects" for those three, otherwise "custom".
- kind "skills" uses "groups": skill lists, grouped and labelled as in the resume.
- kind "text" uses "text": a paragraph, such as a summary or objective.
- kind "list" uses "items": one-line items (certifications, awards, activities, languages, interests).
- preset is "none" for every kind except "entries".
Rules:
- Include every section of the resume, in its original order, with its original heading.
- Copy the wording exactly. Do not summarise, merge, shorten, translate or invent anything.
- One bullet for each bullet point or line in the resume. Leave a field "" when the resume does not have it.
- Put email, phone, location and profile links (GitHub, LinkedIn, portfolio) in the header.`;

const TEX_NOTES = `The input is LaTeX source. Read the text the document prints:
ignore package setup, convert formatting to plain text (\\textbf{x} becomes x, \\& becomes &),
take URLs from \\href{url}{text} into links, and use each macro's arguments as the fields they fill.`;

// LaTeX source without comments and package setup, to save tokens.
const prepareTex = (source) =>
    String(source)
        .replace(/(^|[^\\])%.*$/gm, '$1')
        .replace(/^\s*\\(documentclass|usepackage|pdfgentounicode|input\{glyphtounicode)[^\n]*$/gm, '')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n\s*\n+/g, '\n')
        .trim();

// Roughly the text a LaTeX document prints, one line per line or item.
const latexToPlain = (source) => {
    let s = prepareTex(source);
    const begin = s.indexOf('\\begin{document}');
    if (begin !== -1) s = s.slice(begin + '\\begin{document}'.length);
    return s
        .replace(/\\end\{document\}[\s\S]*$/, '')
        .replace(/\\(begin|end)\{[^}]*\}/g, '\n')
        .replace(/\\href\{([^}]*)\}\{([^}]*)\}/g, '$2 $1')
        .replace(/\\\\(\[[^\]]*\])?/g, '\n')
        .replace(/\\(item|section\*?|subsection\*?|resumeItem|resumeSubheading|resumeProjectHeading)\b/g, '\n')
        .replace(/\{\s*-?[\d.]+\s*(pt|mm|cm|in|em|ex|bp)\s*\}/g, ' ') // sizes such as \fontsize{10pt}{12pt}
        .replace(/\\([&%$#_{}])/g, '$1')
        .replace(/\\[a-zA-Z@]+\*?(\[[^\]]*\])?/g, ' ')
        .replace(/[{}~$\\]/g, ' ')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n\s*\n+/g, '\n')
        .trim();
};

const texHeadings = (source) =>
    [...prepareTex(source).matchAll(/\\section\*?\{([^}]*)\}/g)].map((m) => m[1].replace(/\\([&%$#_])/g, '$1').trim());

const words = (s) => (String(s).toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter((w) => w.length > 1);

// Which lines of the file have their words in the result. A line counts as
// captured when 60% of its words are there, so reformatting does not count as loss.
const coverage = (plainSource, resume) => {
    const have = new Set(words(resumeToText(resume)));
    let checked = 0;
    let matched = 0;
    const missed = [];
    for (const raw of String(plainSource).split(/\r?\n/)) {
        const line = raw.trim();
        const w = words(line);
        if (w.length < 3) continue; // page numbers, lone bullets, short headings
        checked++;
        if (w.filter((x) => have.has(x)).length / w.length >= 0.6) matched++;
        else if (missed.length < 30) missed.push(line.slice(0, 240));
    }
    return { checkedLines: checked, matchedLines: matched, missed };
};

/**
 * @param {{ kind: 'pdf' | 'tex', content: string, fileName: string }} upload
 *   content is the PDF's text, or the .tex source.
 */
const importResume = async ({ kind, content, fileName }) => {
    const input = kind === 'tex' ? prepareTex(content) : String(content);
    const truncated = input.length > MAX_INPUT_CHARS;
    const user = `${FORMAT}\n${kind === 'tex' ? `\n${TEX_NOTES}\n` : ''}\nResume ${kind === 'tex' ? 'LaTeX source' : 'text, extracted from a PDF'}:\n${truncateForBudget(input)}`;

    // The answer repeats the whole resume, so give it whatever the per-minute
    // token budget leaves after the prompt (about 3.5 characters per token).
    const promptTokens = Math.ceil((SYSTEM.length + user.length + JSON.stringify(SCHEMA).length) / 3.5);
    const maxTokens = Math.max(2000, Math.min(6000, TPM_BUDGET - promptTokens - 300));

    const raw = await completeJson({ system: SYSTEM, user, schema: SCHEMA, minimalThinking: true, maxTokens });
    const data = raw.header || raw.sections ? raw : raw.resume || Object.values(raw)[0] || {};

    const resume = { header: cleanHeader(data.header), sections: cleanSections(data.sections) };
    if (!resume.sections.length && !resume.header.name) {
        throw new Error('No resume content was found in this file');
    }

    const plain = kind === 'tex' ? latexToPlain(content) : String(content);
    const found = new Set(resume.sections.map((s) => s.heading.trim().toLowerCase()));
    const report = {
        source: kind,
        fileName,
        sections: resume.sections.map((s) => ({
            heading: s.heading,
            kind: s.kind,
            preset: s.preset,
            count: s.kind === 'entries' ? s.entries.length : s.kind === 'skills' ? s.groups.length : s.kind === 'list' ? s.items.length : 1,
        })),
        ...coverage(plain, resume),
        missingHeadings: kind === 'tex' ? texHeadings(content).filter((h) => h && !found.has(h.toLowerCase())) : [],
        truncated,
    };
    return { resume, report };
};

module.exports = { importResume, latexToPlain, coverage };
