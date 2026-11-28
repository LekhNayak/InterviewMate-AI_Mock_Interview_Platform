import { useState } from "react";
import type { ReactNode } from "react";
import {
    AlertTriangle, ArrowRight, Check, CheckCircle2, CircleDashed, Copy, FileCheck2, Gauge,
    KeyRound, Lightbulb, ListChecks, ShieldAlert, Sparkles, Target, XCircle,
} from "lucide-react";
import type { AtsReport, Check as FormatCheck, Keyword, Requirement, Status, Verdict } from "./types";

/*
 * The report is a bento grid that adapts to the width of its own panel (container
 * queries), not the window, so it fills the space whatever the sidebar and form take:
 * one column when narrow, six from 42rem, twelve from 72rem.
 */

const VERDICT: Record<Verdict, { label: string; text: string; ring: string; soft: string }> = {
    strong: { label: "Strong match", text: "text-emerald-600", ring: "stroke-emerald-500", soft: "bg-emerald-50 text-emerald-700" },
    good: { label: "Good match", text: "text-green-600", ring: "stroke-green-500", soft: "bg-green-50 text-green-700" },
    fair: { label: "Partial match", text: "text-amber-600", ring: "stroke-amber-500", soft: "bg-amber-50 text-amber-700" },
    low: { label: "Low match", text: "text-red-600", ring: "stroke-red-500", soft: "bg-red-50 text-red-700" },
};

const barColor = (score: number) =>
    score >= 75 ? "bg-emerald-500" : score >= 55 ? "bg-green-500" : score >= 40 ? "bg-amber-500" : "bg-red-500";

function Card({ title, icon, aside, className = "", children }: {
    title?: string; icon?: ReactNode; aside?: ReactNode; className?: string; children: ReactNode;
}) {
    return (
        <section className={`flex min-w-0 flex-col rounded-2xl border border-gray-200 bg-white p-5 ${className}`}>
            {title && (
                <header className="mb-3 flex items-center justify-between gap-2">
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-800">{icon}{title}</h3>
                    {aside}
                </header>
            )}
            {children}
        </section>
    );
}

function ScoreGauge({ report, cached }: { report: AtsReport; cached: boolean }) {
    const v = VERDICT[report.verdict];
    const r = 52;
    const circumference = 2 * Math.PI * r;
    return (
        <Card className="items-center justify-center text-center @2xl:col-span-2 @6xl:col-span-3">
            <div className="relative h-36 w-36">
                <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90" aria-hidden="true">
                    <circle cx="60" cy="60" r={r} fill="none" strokeWidth="10" className="stroke-gray-100" />
                    <circle
                        cx="60" cy="60" r={r} fill="none" strokeWidth="10" strokeLinecap="round"
                        className={`${v.ring} transition-[stroke-dashoffset] duration-700`}
                        strokeDasharray={circumference}
                        strokeDashoffset={circumference * (1 - report.score / 100)}
                    />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className={`text-4xl font-bold ${v.text}`}>{report.score}</span>
                    <span className="text-[11px] font-medium text-gray-400">ATS score</span>
                </div>
            </div>
            <span className={`mt-3 rounded-full px-3 py-1 text-xs font-semibold ${v.soft}`}>{v.label}</span>
            <p className="mt-3 line-clamp-2 text-sm font-medium text-gray-800">{report.job.title || "Target role"}</p>
            {report.job.company && <p className="text-xs text-gray-500">{report.job.company}</p>}
            <p className="mt-2 text-[11px] text-gray-400">
                Scored as <span className="font-medium text-gray-600">{report.style_name}</span>
                {cached && " · saved result"}
            </p>
        </Card>
    );
}

function Breakdown({ report }: { report: AtsReport }) {
    return (
        <Card title="How the score is made" icon={<Gauge className="h-4 w-4 text-gray-500" />} className="@2xl:col-span-4 @6xl:col-span-5">
            <ul className="flex flex-col gap-3">
                {report.components.map((c) => (
                    <li key={c.key} className={c.applies ? "" : "opacity-45"}>
                        <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
                            <span className="font-medium text-gray-700">{c.label}</span>
                            <span className="shrink-0 tabular-nums text-gray-500">
                                {c.applies ? <><span className="font-semibold text-gray-800">{c.score}</span> · {c.weight}% of score</> : "Not in this job"}
                            </span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                            {c.applies && c.score !== null && (
                                <div className={`h-full rounded-full ${barColor(c.score)}`} style={{ width: `${Math.max(2, c.score)}%` }} />
                            )}
                        </div>
                        {c.applies && c.detail && <p className="mt-1 text-[11px] text-gray-400">{c.detail}</p>}
                    </li>
                ))}
            </ul>
        </Card>
    );
}

function Stat({ label, value, sub, icon }: { label: string; value: string; sub?: string; icon: ReactNode }) {
    return (
        <div className="flex flex-col justify-between rounded-xl bg-gray-50 p-4">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{icon}{label}</div>
            <p className="mt-2 text-2xl font-bold tabular-nums text-gray-800">{value}</p>
            {sub && <p className="text-[11px] text-gray-500">{sub}</p>}
        </div>
    );
}

function KeyStats({ report }: { report: AtsReport }) {
    const required = report.requirements.filter((r) => r.importance === "required");
    const met = required.filter((r) => r.status === "met").length;
    const partial = required.filter((r) => r.status === "partial").length;
    const exact = report.keywords.filter((k) => k.match === "exact").length;
    const context = report.keywords.filter((k) => k.match === "context").length;
    const passed = report.checks.filter((c) => c.status === "pass").length;
    const need = report.job.min_years;
    const have = report.candidate.relevant_years;
    return (
        <Card className="@2xl:col-span-6 @6xl:col-span-4">
            <div className="grid h-full grid-cols-2 gap-3 @2xl:grid-cols-4 @6xl:grid-cols-2">
                <Stat icon={<Target className="h-3.5 w-3.5" />} label="Required" value={`${met}/${required.length}`}
                    sub={partial ? `${partial} more partly` : "requirements met"} />
                <Stat icon={<KeyRound className="h-3.5 w-3.5" />} label="Keywords" value={`${exact}/${report.keywords.length}`}
                    sub={context ? `${context} more in other words` : "written in your resume"} />
                <Stat icon={<FileCheck2 className="h-3.5 w-3.5" />} label="Format" value={`${passed}/${report.checks.length}`}
                    sub="readability checks passed" />
                <Stat icon={<Sparkles className="h-3.5 w-3.5" />} label="Experience" value={`${have.toFixed(1).replace(/\.0$/, "")} yr`}
                    sub={need ? `job asks for ${need}+` : "no minimum stated"} />
            </div>
        </Card>
    );
}

const STATUS: Record<Status, { icon: ReactNode; label: string; chip: string }> = {
    met: { icon: <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />, label: "Met", chip: "bg-emerald-50 text-emerald-700" },
    partial: { icon: <CircleDashed className="h-4 w-4 shrink-0 text-amber-500" />, label: "Partly", chip: "bg-amber-50 text-amber-700" },
    missing: { icon: <XCircle className="h-4 w-4 shrink-0 text-red-400" />, label: "Missing", chip: "bg-red-50 text-red-600" },
};

type Filter = "all" | Status;

function RequirementRow({ req }: { req: Requirement }) {
    const s = STATUS[req.status];
    return (
        <li className="flex gap-3 border-b border-gray-100 py-3 last:border-0">
            <span className="mt-0.5">{s.icon}</span>
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-medium text-gray-800">{req.label}</span>
                    {req.knockout && <span className="rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white">Must have</span>}
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${req.importance === "required" ? "bg-gray-800 text-white" : "bg-gray-100 text-gray-500"}`}>
                        {req.importance}
                    </span>
                    {!req.verified && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-700" title="The AI claimed evidence that is not in your resume">Unverified</span>}
                </div>
                {req.aliases.length > 0 && <p className="mt-0.5 truncate text-[11px] text-gray-400">Also counts: {req.aliases.join(", ")}</p>}
                {req.evidence && (
                    <blockquote className="mt-1.5 line-clamp-2 border-l-2 border-gray-200 pl-2 text-xs italic text-gray-500" title={req.evidence}>
                        “{req.evidence}”
                    </blockquote>
                )}
                {req.note && <p className="mt-1 text-xs text-gray-500">{req.note}</p>}
            </div>
        </li>
    );
}

function Requirements({ report }: { report: AtsReport }) {
    const [filter, setFilter] = useState<Filter>("all");
    const counts = { all: report.requirements.length, met: 0, partial: 0, missing: 0 };
    report.requirements.forEach((r) => counts[r.status]++);
    const order: Record<Status, number> = { missing: 0, partial: 1, met: 2 };
    const rows = report.requirements
        .filter((r) => filter === "all" || r.status === filter)
        .sort((a, b) => Number(b.knockout) - Number(a.knockout)
            || Number(a.importance === "preferred") - Number(b.importance === "preferred")
            || order[a.status] - order[b.status]);
    const tabs: [Filter, string][] = [["all", "All"], ["missing", "Missing"], ["partial", "Partly"], ["met", "Met"]];

    return (
        <Card
            title="Requirements"
            icon={<ListChecks className="h-4 w-4 text-gray-500" />}
            className="@2xl:col-span-6 @6xl:col-span-7 @6xl:max-h-144"
            aside={
                <div className="flex gap-1 rounded-lg bg-gray-100 p-0.5" role="tablist" aria-label="Filter requirements">
                    {tabs.map(([key, label]) => (
                        <button
                            key={key} type="button" role="tab" aria-selected={filter === key}
                            onClick={() => setFilter(key)}
                            className={`rounded-md px-2 py-1 text-[11px] font-medium transition ${filter === key ? "bg-white text-gray-800 shadow-sm" : "text-gray-500 hover:text-gray-700"}`}
                        >
                            {label} <span className="tabular-nums text-gray-400">{counts[key]}</span>
                        </button>
                    ))}
                </div>
            }
        >
            <p className="-mt-1 mb-1 text-[11px] text-gray-400">
                Each requirement was checked against your resume. Quotes are your own words, confirmed to be in the file.
            </p>
            <ul className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
                {rows.map((r) => <RequirementRow key={r.label} req={r} />)}
                {!rows.length && <li className="py-6 text-center text-xs text-gray-400">Nothing here.</li>}
            </ul>
        </Card>
    );
}

function KeywordChip({ k }: { k: Keyword }) {
    const style = k.match === "exact"
        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
        : k.match === "context"
            ? "border-amber-200 bg-amber-50 text-amber-700"
            : "border-red-200 bg-white text-red-600";
    const tip = k.match === "exact"
        ? `In your resume ${k.resume_count}× · in the job ${k.jd_count}×`
        : k.match === "context"
            ? "Your resume shows this, but not in these words. Write the exact term so keyword filters find it."
            : `In the job ${k.jd_count}× · not in your resume`;
    return (
        <span title={tip} className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] ${style}`}>
            {k.importance === "required" && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-label="required" />}
            {k.term}
            {k.match === "exact" && k.resume_count > 1 && <span className="tabular-nums opacity-60">×{k.resume_count}</span>}
        </span>
    );
}

function Keywords({ report }: { report: AtsReport }) {
    const groups: [Keyword["match"], string, string][] = [
        ["none", "Missing", "Add these where you truly have them."],
        ["context", "Shown in other words", "Use the job's exact wording; many ATS match words literally."],
        ["exact", "Found", "Written in your resume."],
    ];
    return (
        <Card title="Keywords" icon={<KeyRound className="h-4 w-4 text-gray-500" />} className="@2xl:col-span-6 @6xl:col-span-5 @6xl:max-h-144"
            aside={<span className="flex items-center gap-1 text-[11px] text-gray-400"><span className="h-1.5 w-1.5 rounded-full bg-gray-400" /> required</span>}>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
                {groups.map(([match, title, hint]) => {
                    const items = report.keywords.filter((k) => k.match === match);
                    if (!items.length) return null;
                    return (
                        <div key={match}>
                            <p className="text-xs font-semibold text-gray-700">{title} <span className="font-normal text-gray-400">{items.length}</span></p>
                            <p className="mb-2 text-[11px] text-gray-400">{hint}</p>
                            <div className="flex flex-wrap gap-1.5">{items.map((k) => <KeywordChip key={k.term} k={k} />)}</div>
                        </div>
                    );
                })}
            </div>
        </Card>
    );
}

const CHECK_ICON: Record<FormatCheck["status"], ReactNode> = {
    pass: <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />,
    warn: <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />,
    fail: <XCircle className="h-4 w-4 shrink-0 text-red-400" />,
};

function Checks({ report, wide }: { report: AtsReport; wide: boolean }) {
    const order = { fail: 0, warn: 1, pass: 2 };
    const checks = [...report.checks].sort((a, b) => order[a.status] - order[b.status]);
    return (
        <Card title="ATS readability" icon={<FileCheck2 className="h-4 w-4 text-gray-500" />}
            className={wide ? "@2xl:col-span-6 @6xl:col-span-12" : "@2xl:col-span-6 @6xl:col-span-4"}
            aside={<span className="text-[11px] text-gray-400">{report.resume.pages} page{report.resume.pages > 1 ? "s" : ""} · {report.resume.words} words</span>}>
            <ul className={`grid gap-x-6 gap-y-2.5 @2xl:grid-cols-2 ${wide ? "@6xl:grid-cols-3" : "@6xl:grid-cols-1"}`}>
                {checks.map((c) => (
                    <li key={c.id} className="flex gap-2">
                        <span className="mt-0.5">{CHECK_ICON[c.status]}</span>
                        <div className="min-w-0">
                            <p className="text-xs font-medium text-gray-700">{c.label}</p>
                            {c.status !== "pass" && <p className="text-[11px] leading-snug text-gray-500">{c.detail}</p>}
                        </div>
                    </li>
                ))}
            </ul>
        </Card>
    );
}

const IMPACT = { high: "bg-red-50 text-red-600", medium: "bg-amber-50 text-amber-700", low: "bg-gray-100 text-gray-500" };

function Suggestions({ items }: { items: NonNullable<AtsReport["insights"]>["suggestions"] }) {
    return (
        <Card title="What to do next" icon={<Lightbulb className="h-4 w-4 text-amber-500" />} className="@2xl:col-span-3 @6xl:col-span-4">
            <ol className="flex flex-col gap-3">
                {items.map((s, i) => (
                    <li key={i} className="flex gap-2.5">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-900 text-[10px] font-semibold text-white">{i + 1}</span>
                        <div className="min-w-0">
                            <p className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-gray-800">
                                {s.title}
                                <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${IMPACT[s.impact]}`}>{s.impact}</span>
                            </p>
                            <p className="mt-0.5 text-xs leading-relaxed text-gray-600">{s.detail}</p>
                        </div>
                    </li>
                ))}
            </ol>
        </Card>
    );
}

function StrengthsGaps({ strengths, gaps }: { strengths: string[]; gaps: string[] }) {
    const list = (items: string[], dot: string) => (
        <ul className="flex flex-col gap-2">
            {items.map((s, i) => (
                <li key={i} className="flex gap-2 text-xs leading-relaxed text-gray-600">
                    <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />{s}
                </li>
            ))}
        </ul>
    );
    return (
        <Card className="@2xl:col-span-3 @6xl:col-span-4">
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-800"><CheckCircle2 className="h-4 w-4 text-emerald-500" />Strengths</h3>
            {list(strengths, "bg-emerald-400")}
            <h3 className="mb-2 mt-5 flex items-center gap-2 text-sm font-semibold text-gray-800"><ShieldAlert className="h-4 w-4 text-red-400" />Gaps</h3>
            {list(gaps, "bg-red-300")}
        </Card>
    );
}

function Rewrites({ items }: { items: NonNullable<AtsReport["insights"]>["bullet_rewrites"] }) {
    const [copied, setCopied] = useState<number | null>(null);
    const copy = async (text: string, i: number) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(i);
            setTimeout(() => setCopied(null), 1500);
        } catch {
            // Clipboard may be blocked; the text is still selectable.
        }
    };
    return (
        <Card title="Stronger bullet points" icon={<Sparkles className="h-4 w-4 text-indigo-400" />} className="@2xl:col-span-6 @6xl:col-span-7">
            <p className="-mt-1 mb-3 text-[11px] text-gray-400">Same facts, sharper wording. Replace [placeholders] with your real numbers.</p>
            <ul className="flex flex-col gap-3">
                {items.map((b, i) => (
                    <li key={i} className="grid gap-2 rounded-xl bg-gray-50 p-3 @4xl:grid-cols-[1fr_auto_1fr] @4xl:items-start">
                        <p className="text-xs leading-relaxed text-gray-500">{b.original}</p>
                        <ArrowRight className="hidden h-4 w-4 text-gray-300 @4xl:mt-0.5 @4xl:block" />
                        <div>
                            <div className="flex items-start gap-2">
                                <p className="flex-1 text-xs font-medium leading-relaxed text-gray-800">{b.improved}</p>
                                <button type="button" onClick={() => copy(b.improved, i)} aria-label="Copy the improved bullet"
                                    className="rounded-md p-1 text-gray-400 hover:bg-white hover:text-gray-700">
                                    {copied === i ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                                </button>
                            </div>
                            <p className="mt-1 text-[11px] text-gray-400">{b.why}</p>
                        </div>
                    </li>
                ))}
            </ul>
        </Card>
    );
}

function Summary({ report, wide }: { report: AtsReport; wide: boolean }) {
    const ins = report.insights!;
    return (
        <Card title="Recruiter's view" icon={<Target className="h-4 w-4 text-gray-500" />}
            className={wide ? "@2xl:col-span-6 @6xl:col-span-12" : "@2xl:col-span-6 @6xl:col-span-5"}>
            {ins.summary && <p className="text-sm leading-relaxed text-gray-700">{ins.summary}</p>}
            {ins.verdict && (
                <p className="mt-3 rounded-xl bg-gray-50 px-4 py-3 text-xs italic leading-relaxed text-gray-600">“{ins.verdict}”</p>
            )}
            {ins.projects_analysis && (
                <>
                    <p className="mt-4 text-xs font-semibold text-gray-700">Projects and work samples</p>
                    <p className="mt-1 text-xs leading-relaxed text-gray-600">{ins.projects_analysis}</p>
                </>
            )}
            {report.candidate.years_evidence && (
                <p className="mt-4 text-[11px] text-gray-400">Experience counted: {report.candidate.years_evidence}</p>
            )}
        </Card>
    );
}

export default function AtsReportView({ report, cached = false }: { report: AtsReport; cached?: boolean }) {
    const ins = report.insights;
    return (
        <div className="@container w-full">
            <div className="grid grid-cols-1 gap-4 @2xl:grid-cols-6 @6xl:grid-cols-12">
                {report.knockouts.length > 0 && (
                    <div className="col-span-full flex gap-3 rounded-2xl border border-red-200 bg-red-50 px-5 py-4">
                        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
                        <div className="text-sm text-red-800">
                            <p className="font-semibold">Must-have requirement missing: {report.knockouts.map((k) => k.label).join(", ")}</p>
                            <p className="mt-0.5 text-xs text-red-700">
                                Most applicant tracking systems screen these out before a recruiter reads the resume
                                {report.capped ? ", so the score is capped at 45." : "."}
                            </p>
                        </div>
                    </div>
                )}

                <ScoreGauge report={report} cached={cached} />
                <Breakdown report={report} />
                <KeyStats report={report} />

                <Requirements report={report} />
                <Keywords report={report} />

                {ins && ins.suggestions.length > 0 && <Suggestions items={ins.suggestions} />}
                {ins && (ins.strengths.length > 0 || ins.gaps.length > 0) && <StrengthsGaps strengths={ins.strengths} gaps={ins.gaps} />}
                <Checks report={report} wide={!ins} />

                {ins && ins.bullet_rewrites.length > 0 && <Rewrites items={ins.bullet_rewrites} />}
                {ins && <Summary report={report} wide={ins.bullet_rewrites.length === 0} />}
            </div>
        </div>
    );
}
