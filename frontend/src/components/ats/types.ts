// The ATS service's report (version 2). See models/Resume ATS and JD/api_service/ats_core.

export type Status = "met" | "partial" | "missing";
export type Verdict = "strong" | "good" | "fair" | "low";
export type ScoringStyle = "auto" | "balanced" | "keyword" | "skills" | "experienced" | "entry";

export interface Requirement {
    label: string;
    category: string;
    importance: "required" | "preferred";
    knockout: boolean;
    aliases: string[];
    status: Status;
    evidence: string;
    note: string;
    /** False when the model claimed evidence the resume does not contain. */
    verified: boolean;
    mentions: number;
}

export interface Keyword {
    term: string;
    importance: "required" | "preferred" | "frequent";
    jd_count: number;
    resume_count: number;
    /** exact: written in the resume. context: shown, but not in these words. */
    match: "exact" | "context" | "none";
    found: boolean;
}

export interface Check {
    id: string;
    label: string;
    status: "pass" | "warn" | "fail";
    detail: string;
    weight: number;
}

export interface ScoreComponent {
    key: string;
    label: string;
    score: number | null;
    /** Share of the overall score, in percent. 0 when it does not apply. */
    weight: number;
    applies: boolean;
    detail: string;
}

export interface Insights {
    summary: string;
    strengths: string[];
    gaps: string[];
    suggestions: { title: string; detail: string; impact: "high" | "medium" | "low" }[];
    bullet_rewrites: { original: string; improved: string; why: string }[];
    projects_analysis: string;
    verdict: string;
}

export interface AtsReport {
    version: number;
    score: number;
    verdict: Verdict;
    style: Exclude<ScoringStyle, "auto">;
    style_name: string;
    components: ScoreComponent[];
    knockouts: { label: string; status: Status }[];
    capped: boolean;
    mode: "jd" | "role";
    job: { title: string; company: string; seniority: string; domain: string; min_years: number | null };
    candidate: { headline: string; relevant_years: number; years_evidence: string };
    requirements: Requirement[];
    keywords: Keyword[];
    checks: Check[];
    resume: { pages: number; words: number; sections: string[] };
    semantic: { available: boolean; score?: number };
    insights: Insights | null;
    rubric_reused?: boolean;
    elapsed_ms?: number;
}

export interface AtsRecord {
    _id: string;
    score?: number;
    report?: AtsReport;
    createdAt?: string;
}
