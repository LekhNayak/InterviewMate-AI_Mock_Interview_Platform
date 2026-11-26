import { v4 as uuid } from "uuid";
import type {
    EntryPreset,
    Resume,
    ResumeEntry,
    ResumeLayout,
    ResumeSection,
    SectionKind,
    SkillGroup,
} from "@/types";

export const DEFAULT_LAYOUT: ResumeLayout = { fontSize: 10.5, lineHeight: 1.3, margin: 15, sectionGap: 10, entryGap: 6 };

/** The same limits as the API (backend/src/utils/resumeFormat.js). */
export const LAYOUT_CONTROLS: { key: keyof ResumeLayout; label: string; min: number; max: number; step: number; unit: string }[] = [
    { key: "fontSize", label: "Font size", min: 8, max: 13, step: 0.5, unit: "pt" },
    { key: "lineHeight", label: "Line spacing", min: 1, max: 1.8, step: 0.05, unit: "×" },
    { key: "margin", label: "Page margins", min: 5, max: 30, step: 1, unit: "mm" },
    { key: "sectionGap", label: "Space between sections", min: 0, max: 30, step: 1, unit: "pt" },
    { key: "entryGap", label: "Space between entries", min: 0, max: 20, step: 1, unit: "pt" },
];

export const clampLayoutValue = (key: keyof ResumeLayout, value: number) => {
    const c = LAYOUT_CONTROLS.find((x) => x.key === key)!;
    const stepped = Math.round(value / c.step) * c.step;
    return Math.min(c.max, Math.max(c.min, Number(stepped.toFixed(2))));
};

/**
 * One notch tighter, for "Fit to one page": gaps first, then line spacing,
 * margins and finally font size. Null when nothing can shrink further.
 */
const FIT_STEPS: [keyof ResumeLayout, number, number][] = [
    ["sectionGap", -2, 4],
    ["entryGap", -1, 2],
    ["lineHeight", -0.05, 1.15],
    ["margin", -1, 10],
    ["fontSize", -0.5, 9.5],
];
export const tightenLayout = (layout: ResumeLayout): ResumeLayout | null => {
    for (const [key, step, floor] of FIT_STEPS) {
        if (layout[key] > floor + 1e-9) {
            return { ...layout, [key]: Math.max(floor, Number((layout[key] + step).toFixed(2))) };
        }
    }
    return null;
};

export const ENTRY_LABELS: Record<EntryPreset, { title: string; subtitle: string; date: string; meta: string }> = {
    experience: { title: "Role", subtitle: "Company", date: "Dates", meta: "Location" },
    education: { title: "Institution", subtitle: "Degree", date: "Dates", meta: "Grade or location" },
    projects: { title: "Project", subtitle: "Tech stack", date: "Dates", meta: "Link or event" },
    custom: { title: "Title", subtitle: "Subtitle", date: "Dates", meta: "Details" },
};

export const KIND_LABELS: Record<SectionKind, string> = {
    text: "Paragraph",
    entries: "Entries",
    skills: "Skills",
    list: "List",
};

export const PRESET_LABELS: Record<EntryPreset, string> = {
    experience: "Experience",
    education: "Education",
    projects: "Projects",
    custom: "Entries",
};

export const newEntry = (): ResumeEntry => ({ id: uuid(), title: "", subtitle: "", date: "", meta: "", bullets: [""] });
export const newGroup = (label = ""): SkillGroup => ({ id: uuid(), label, items: [] });

const entries = (heading: string, preset: EntryPreset): ResumeSection => ({ id: uuid(), kind: "entries", heading, preset, entries: [] });
const list = (heading: string): ResumeSection => ({ id: uuid(), kind: "list", heading, items: [] });

/** What "Add section" offers. */
export const SECTION_TEMPLATES: { label: string; make: () => ResumeSection }[] = [
    { label: "Summary", make: () => ({ id: uuid(), kind: "text", heading: "Summary", text: "" }) },
    { label: "Experience", make: () => entries("Experience", "experience") },
    { label: "Education", make: () => entries("Education", "education") },
    { label: "Projects", make: () => entries("Projects", "projects") },
    { label: "Skills", make: () => ({ id: uuid(), kind: "skills", heading: "Technical Skills", groups: [newGroup("Languages")] }) },
    { label: "Certifications", make: () => list("Certifications") },
    { label: "Achievements", make: () => list("Achievements") },
    { label: "Activities", make: () => list("Extracurricular Activities") },
    { label: "Custom list", make: () => list("New Section") },
    { label: "Custom entries", make: () => entries("New Section", "custom") },
];

const fromTemplate = (label: string) => SECTION_TEMPLATES.find((t) => t.label === label)!.make();

export const createEmptyResume = (title = "Untitled Resume"): Resume => ({
    _id: uuid(),
    title,
    source: "scratch",
    header: { name: "", email: "", phone: "", location: "", links: [] },
    sections: ["Summary", "Experience", "Education", "Projects", "Skills"].map(fromTemplate),
    layout: { ...DEFAULT_LAYOUT },
});

/** A new, unsaved copy that keeps the content but not the uploaded file. */
export const duplicateResume = (resume: Resume): Resume => ({
    ...structuredClone(resume),
    _id: uuid(),
    title: `${resume.title} (copy)`,
    pdfUrl: undefined,
    source: "scratch",
    sourceName: undefined,
    importReport: undefined,
});

/** Saved resumes have MongoDB ids; drafts have uuids until they are saved. */
export const isSaved = (id?: string) => !!id && /^[0-9a-f]{24}$/i.test(id);

/** Fills anything missing, so older or partial data renders. */
export const normalizeResume = (raw: Partial<Resume>): Resume => ({
    ...raw,
    title: raw.title || "Untitled Resume",
    header: {
        name: raw.header?.name ?? "",
        email: raw.header?.email ?? "",
        phone: raw.header?.phone ?? "",
        location: raw.header?.location ?? "",
        links: raw.header?.links ?? [],
    },
    sections: raw.sections ?? [],
    layout: { ...DEFAULT_LAYOUT, ...raw.layout },
});

/** The fields Save sends, as a string to compare for unsaved changes. */
export const snapshot = (r: Resume) => JSON.stringify([r.title, r.header, r.sections, r.layout]);

export const sectionCount = (s: ResumeSection) => {
    if (s.kind === "text") {
        const words = s.text.trim() ? s.text.trim().split(/\s+/).length : 0;
        return words ? `${words} ${words === 1 ? "word" : "words"}` : "Empty";
    }
    const [n, one, many] =
        s.kind === "entries" ? [s.entries.length, "entry", "entries"]
            : s.kind === "skills" ? [s.groups.length, "group", "groups"]
                : [s.items.length, "item", "items"];
    return `${n} ${n === 1 ? one : many}`;
};

export const displayUrl = (url: string) => url.replace(/^(https?:\/\/(www\.)?|mailto:)/i, "").replace(/\/$/, "");
export const hrefFor = (url: string) => (/^(https?:|mailto:)/i.test(url) ? url : `https://${url}`);

export const fileNameFor = (resume: Resume) =>
    (resume.header.name || resume.title || "resume").replace(/[\\/:*?"<>|]+/g, "").trim() || "resume";
