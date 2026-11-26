// The resume format shared by the API, the builder and the importer.
//
// A resume is a header and an ordered list of sections. Each section is one of:
//   text     a paragraph                       { text }
//   entries  dated items (experience, ...)     { preset, entries: [{ title, subtitle, date, meta, bullets }] }
//   skills   labelled groups                   { groups: [{ label, items }] }
//   list     one-line items (awards, ...)      { items }
//
// Resumes saved before this format have fixed fields (objective, education,
// skills, projects, activities). toClient() converts them when they are read.

const crypto = require('crypto');

const SECTION_KINDS = ['text', 'entries', 'skills', 'list'];
const ENTRY_PRESETS = ['experience', 'education', 'projects', 'custom'];
const SOURCES = ['pdf', 'tex', 'scratch'];

const DEFAULT_LAYOUT = { fontSize: 10.5, lineHeight: 1.3, margin: 15, sectionGap: 10, entryGap: 6 };
const LAYOUT_LIMITS = {
    fontSize: [8, 13], // pt
    lineHeight: [1, 1.8],
    margin: [5, 30], // mm
    sectionGap: [0, 30], // pt
    entryGap: [0, 20], // pt
};

// Caps keep one resume document small whatever a client or the model sends.
const MAX = { sections: 30, entries: 40, bullets: 30, groups: 20, items: 60, links: 10, short: 300, long: 5000 };

const LEGACY_FIELDS = ['objective', 'education', 'skills', 'projects', 'activities'];

const newId = () => crypto.randomBytes(6).toString('hex');

const str = (value, max = MAX.short) => (typeof value === 'string' ? value : value == null ? '' : String(value)).slice(0, max);
const strList = (value, maxItems, maxLen = MAX.long) =>
    (Array.isArray(value) ? value : []).slice(0, maxItems).map((v) => str(v, maxLen));
const id = (value) => (typeof value === 'string' && /^[\w-]{1,64}$/.test(value) ? value : newId());

const linkLabel = (url) => {
    const host = String(url).toLowerCase();
    if (host.includes('github.')) return 'GitHub';
    if (host.includes('linkedin.')) return 'LinkedIn';
    if (host.includes('leetcode.')) return 'LeetCode';
    return 'Website';
};

const cleanHeader = (h = {}) => ({
    name: str(h.name),
    email: str(h.email),
    phone: str(h.phone),
    location: str(h.location),
    links: (Array.isArray(h.links) ? h.links : [])
        .slice(0, MAX.links)
        .map((l) => ({ label: str(l?.label) || (l?.url ? linkLabel(l.url) : ''), url: str(l?.url, 500) }))
        .filter((l) => l.label || l.url),
});

const cleanEntry = (e = {}) => ({
    id: id(e.id),
    title: str(e.title),
    subtitle: str(e.subtitle),
    date: str(e.date),
    meta: str(e.meta),
    bullets: strList(e.bullets, MAX.bullets),
});

const filled = (v) => (Array.isArray(v) ? v.length > 0 : typeof v === 'string' && v.trim() !== '');

// The kind a section names, or else the one its fields suggest.
const kindOf = (s) => {
    const named = s.kind ?? s.type;
    if (SECTION_KINDS.includes(named)) return named;
    if (filled(s.entries)) return 'entries';
    if (filled(s.groups)) return 'skills';
    if (filled(s.text)) return 'text';
    return 'list';
};

const cleanSection = (s = {}) => {
    s = s && typeof s === 'object' ? s : {};
    const kind = kindOf(s);
    const base = { id: id(s.id), kind, heading: str(s.heading ?? s.name ?? s.title), hidden: Boolean(s.hidden) };
    if (kind === 'text') return { ...base, text: str(s.text, MAX.long) };
    if (kind === 'entries') {
        return {
            ...base,
            preset: ENTRY_PRESETS.includes(s.preset) ? s.preset : 'custom',
            entries: (Array.isArray(s.entries) ? s.entries : []).slice(0, MAX.entries).map(cleanEntry),
        };
    }
    if (kind === 'skills') {
        return {
            ...base,
            groups: (Array.isArray(s.groups) ? s.groups : []).slice(0, MAX.groups).map((g) => ({
                id: id(g?.id),
                label: str(g?.label),
                items: strList(g?.items, MAX.items, MAX.short),
            })),
        };
    }
    return { ...base, items: strList(s.items, MAX.items) };
};

const cleanSections = (sections) => (Array.isArray(sections) ? sections : []).slice(0, MAX.sections).map(cleanSection);

const clamp = (value, [min, max], fallback) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

const cleanLayout = (l = {}) =>
    Object.fromEntries(
        Object.entries(DEFAULT_LAYOUT).map(([key, fallback]) => [key, clamp(l?.[key], LAYOUT_LIMITS[key], fallback)])
    );

// Sections from a resume saved in the old fixed format.
const fromLegacy = (doc) => {
    const sections = [];
    if (doc.objective) sections.push({ id: newId(), kind: 'text', heading: 'Objective', hidden: false, text: doc.objective });

    if (doc.education?.length) {
        sections.push({
            id: newId(), kind: 'entries', preset: 'education', heading: 'Education', hidden: false,
            entries: doc.education.map((e) => cleanEntry({
                title: e.institution, subtitle: e.degree, date: e.duration, meta: e.score, bullets: [],
            })),
        });
    }

    const skills = doc.skills || {};
    const groups = [
        ['Languages', skills.languages],
        ['Frameworks & Tools', skills.frameworks],
        ['Other', skills.other],
    ].filter(([, items]) => items?.length);
    if (groups.length) {
        sections.push({
            id: newId(), kind: 'skills', heading: 'Technical Skills', hidden: false,
            groups: groups.map(([label, items]) => ({ id: newId(), label, items: [...items] })),
        });
    }

    if (doc.projects?.length) {
        sections.push({
            id: newId(), kind: 'entries', preset: 'projects', heading: 'Projects', hidden: false,
            entries: doc.projects.map((p) => cleanEntry({
                title: p.title, subtitle: p.tech, date: p.duration, meta: p.event, bullets: p.points,
            })),
        });
    }

    if (doc.activities?.length) {
        sections.push({ id: newId(), kind: 'list', heading: 'Extracurricular Activities', hidden: false, items: [...doc.activities] });
    }
    return sections;
};

const isLegacy = (doc) => !doc.sections?.length && LEGACY_FIELDS.some((f) => {
    const v = doc[f];
    return Array.isArray(v) ? v.length : v && (typeof v !== 'object' || Object.values(v).some((x) => x?.length));
});

// A stored resume (old or new format) in the shape the builder uses.
const toClient = (doc) => {
    if (!doc) return doc;
    const d = typeof doc.toObject === 'function' ? doc.toObject() : doc;
    const header = cleanHeader(d.header);
    if (d.header?.github && !header.links.some((l) => l.url === d.header.github)) {
        header.links.unshift({ label: 'GitHub', url: d.header.github });
    }
    return {
        _id: d._id,
        title: d.title,
        pdfUrl: d.pdfUrl,
        source: d.source,
        sourceName: d.sourceName,
        header,
        sections: isLegacy(d) ? fromLegacy(d) : cleanSections(d.sections),
        layout: cleanLayout(d.layout),
        importReport: d.importReport,
    };
};

// Plain text of a resume: what the interview reads, and what the importer
// compares with the uploaded file.
const resumeToText = (resume) => {
    const lines = [];
    const h = resume.header || {};
    lines.push(h.name, [h.email, h.phone, h.location].filter(Boolean).join(' | '));
    for (const l of h.links || []) lines.push(`${l.label}: ${l.url}`);

    for (const s of resume.sections || []) {
        if (s.hidden) continue;
        lines.push('', (s.heading || '').toUpperCase());
        if (s.kind === 'text') lines.push(s.text);
        if (s.kind === 'list') for (const item of s.items || []) lines.push(`- ${item}`);
        if (s.kind === 'skills') for (const g of s.groups || []) lines.push(`${g.label}: ${(g.items || []).join(', ')}`);
        if (s.kind === 'entries') {
            for (const e of s.entries || []) {
                lines.push([e.title, e.subtitle, e.date, e.meta].filter(Boolean).join(' | '));
                for (const b of e.bullets || []) lines.push(`- ${b}`);
            }
        }
    }
    return lines.filter((l) => l != null).join('\n').replace(/\n{3,}/g, '\n\n').trim();
};

module.exports = {
    SECTION_KINDS,
    ENTRY_PRESETS,
    SOURCES,
    DEFAULT_LAYOUT,
    LEGACY_FIELDS,
    cleanHeader,
    cleanSections,
    cleanLayout,
    toClient,
    resumeToText,
};
