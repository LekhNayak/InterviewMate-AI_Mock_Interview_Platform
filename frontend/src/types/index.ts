// A resume is a header and an ordered list of sections. The API cleans and
// stores the same shape (backend/src/utils/resumeFormat.js).

export interface ResumeLink {
    label: string;
    url: string;
}

export interface ResumeHeader {
    name: string;
    email: string;
    phone: string;
    location: string;
    links: ResumeLink[];
}

/** One item of an entries section: a job, a degree, a project. */
export interface ResumeEntry {
    id: string;
    title: string;
    subtitle: string;
    date: string;
    /** Shown on the right of the second line: location, grade, link. */
    meta: string;
    bullets: string[];
}

export interface SkillGroup {
    id: string;
    label: string;
    items: string[];
}

/** Picks the field labels of an entries section in the editor. */
export type EntryPreset = "experience" | "education" | "projects" | "custom";

interface SectionBase {
    id: string;
    heading: string;
    hidden?: boolean;
}

export type TextSection = SectionBase & { kind: "text"; text: string };
export type EntriesSection = SectionBase & { kind: "entries"; preset: EntryPreset; entries: ResumeEntry[] };
export type SkillsSection = SectionBase & { kind: "skills"; groups: SkillGroup[] };
export type ListSection = SectionBase & { kind: "list"; items: string[] };
export type ResumeSection = TextSection | EntriesSection | SkillsSection | ListSection;
export type SectionKind = ResumeSection["kind"];

/** Page settings, saved with each resume. Sizes in pt, margins in mm. */
export interface ResumeLayout {
    fontSize: number;
    lineHeight: number;
    margin: number;
    sectionGap: number;
    entryGap: number;
}

/** What the importer found in an uploaded file. */
export interface ImportReport {
    source: "pdf" | "tex";
    fileName: string;
    sections: { heading: string; kind: SectionKind; preset?: EntryPreset; count: number }[];
    checkedLines: number;
    matchedLines: number;
    /** Lines of the file whose words are mostly missing from the result. */
    missed: string[];
    /** Section headings in a .tex file that no extracted section has. */
    missingHeadings: string[];
    truncated: boolean;
}

export interface Resume {
    _id?: string;
    title: string;
    /** The uploaded PDF. The ATS Checker reads it. */
    pdfUrl?: string;
    source?: "pdf" | "tex" | "scratch";
    sourceName?: string;
    header: ResumeHeader;
    sections: ResumeSection[];
    layout: ResumeLayout;
    importReport?: ImportReport;
}

export interface User {
    _id: string;
    name: string;
    email: string;
    avatarUrl?: string;
    age?: number;
    gender?: string;
    githubUrl?: string;
    linkedinUrl?: string;
    codeforcesUrl?: string;
    leetcodeUrl?: string;
    skills?: string[];
    interests?: string[];
}

export interface JobDescription {
    _id: string;
    url: string;
    title: string;
    company: string;
    location: string;
    description?: string;
    requiredSkills: string[];
    jobType: string;
    createdAt: string;
}

// One answer, as returned by the emotion service.
export interface EmotionPrediction {
    emotion: string;
    confidence: number;
    predictions: Record<string, number>;
}

export interface EmotionResult {
    emotions_3?: EmotionPrediction;
    emotions_6?: EmotionPrediction;
    speaking_style?: { label: string; score: number };
}

// All recorded answers of an interview, averaged.
export interface EmotionSummary {
    answers: number;
    speaking_style?: { label: string; score: number };
    emotions_3?: { emotion: string; confidence: number };
    emotions_6?: { emotion: string; confidence: number };
}
