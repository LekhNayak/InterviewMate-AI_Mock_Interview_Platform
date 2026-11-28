import { useEffect, useState } from "react";
import { useMyJds, useResumes } from "@/lib/queries";
import { toast } from "sonner";
import { Briefcase, ChevronDown, FileText, Loader2, ScanSearch } from "lucide-react";
import AtsReportView from "@/components/ats/AtsReportView";
import ReportBoundary from "@/components/ats/ReportBoundary";
import type { AtsRecord, ScoringStyle } from "@/components/ats/types";

const API = import.meta.env.VITE_API_BASE_URL;

interface Resume { _id: string; title: string; }
interface JD { _id: string; title: string; company: string; }
type Mode = "quick" | "jd";

const STYLES: { value: ScoringStyle; label: string; hint: string }[] = [
    { value: "auto", label: "Auto (recommended)", hint: "Picks a style from the job's level." },
    { value: "balanced", label: "Balanced", hint: "Requirements, experience and keywords weighed evenly." },
    { value: "keyword", label: "Classic ATS", hint: "Keyword matching counts most, like older ATS filters." },
    { value: "skills", label: "Skills first", hint: "What you can do counts most." },
    { value: "experienced", label: "Experienced hire", hint: "Years and responsibilities count more." },
    { value: "entry", label: "Entry level", hint: "For students and freshers: education counts, years count less." },
];

// What the service is doing, shown while the user waits (an analysis takes about 10 seconds).
const STEPS = ["Reading your resume…", "Building the job's requirement rubric…", "Checking each requirement against your resume…",
    "Verifying every quote and keyword…", "Writing your feedback…"];

function SelectField({ label, value, onChange, children, hint }: {
    label: string; value: string; onChange: (v: string) => void;
    children: React.ReactNode; hint?: string;
}) {
    return (
        <div>
            <label className="text-[11px] font-semibold text-gray-400 mb-1.5 block tracking-wider uppercase">{label}</label>
            <div className="relative">
                <select
                    value={value}
                    onChange={e => onChange(e.target.value)}
                    className="w-full appearance-none bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-700 pr-9 focus:outline-none focus:border-gray-400 transition"
                >
                    {children}
                </select>
                <ChevronDown className="absolute right-3 top-3 h-4 w-4 text-gray-400 pointer-events-none" />
            </div>
            {hint && <p className="text-[11px] text-gray-400 mt-1">{hint}</p>}
        </div>
    );
}

function Progress() {
    const [step, setStep] = useState(0);
    useEffect(() => {
        const id = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 2600);
        return () => clearInterval(id);
    }, []);
    return (
        <div className="flex h-full flex-col items-center justify-center gap-4 text-gray-500">
            <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
            <ol className="flex flex-col gap-1.5 text-sm">
                {STEPS.map((s, i) => (
                    <li key={s} className={i < step ? "text-gray-300 line-through" : i === step ? "font-medium text-gray-700" : "text-gray-300"}>{s}</li>
                ))}
            </ol>
        </div>
    );
}

export default function ATSChecker() {
    const [mode, setMode] = useState<Mode>("quick");
    const resumes = (useResumes().data ?? []) as Resume[];
    const jds = useMyJds<JD>().data ?? [];
    const [resumeId, setResumeId] = useState("");
    const [jobRole, setJobRole] = useState("");
    const [jdId, setJdId] = useState("");
    const [style, setStyle] = useState<ScoringStyle>("auto");
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<{ record: AtsRecord; cached: boolean } | null>(null);

    const handleAnalyze = async () => {
        if (!resumeId) return toast.error("Please select a resume.");
        if (mode === "quick" && !jobRole.trim()) return toast.error("Please enter a job role.");
        if (mode === "jd" && !jdId) return toast.error("Please select a job description.");

        setLoading(true);
        setResult(null);
        try {
            const endpoint = mode === "quick" ? `${API}/ats/quick-analyze` : `${API}/ats/analyze`;
            const body = mode === "quick" ? { resumeId, jobRole, style } : { resumeId, jdId, style };
            const res = await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify(body),
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                toast.error(data.error || "The analysis failed. Try again in a minute.");
                return;
            }
            setResult({ record: data.ats, cached: !!data.cached });
            toast.success(data.cached ? "Same resume and job as before: showing that analysis." : "Analysis complete!");
        } catch {
            toast.error("Network error. Check your connection and try again.");
        } finally {
            setLoading(false);
        }
    };

    // Only a version 2 report can be drawn; anything else gets the message below.
    const raw = result?.record.report;
    const report = raw && raw.version === 2 && Array.isArray(raw.requirements) && Array.isArray(raw.components) ? raw : undefined;
    const styleHint = STYLES.find((s) => s.value === style)?.hint;

    return (
        /* Fills exactly the space below TopNav; each panel scrolls on its own */
        <div className="flex overflow-hidden" style={{ height: "calc(100vh - 3.5rem)" }}>

            {/* ── LEFT PANEL: form ── */}
            <div className="w-[320px] shrink-0 border-r border-gray-200 flex flex-col gap-5 p-6 overflow-y-auto">
                <div>
                    <h1 className="text-lg font-semibold text-gray-800">Resume Analyzer</h1>
                    <p className="text-xs text-gray-400 mt-0.5">Score your resume against a job, the way applicant tracking systems do</p>
                </div>

                <div className="flex flex-col gap-2">
                    <button
                        onClick={() => { setMode("quick"); setResult(null); }}
                        className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition border ${mode === "quick"
                            ? "bg-black text-white border-black"
                            : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"}`}
                    >
                        <Briefcase className="h-4 w-4" /> Quick Check (Job Role)
                    </button>
                    <button
                        onClick={() => { setMode("jd"); setResult(null); }}
                        className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition border ${mode === "jd"
                            ? "bg-black text-white border-black"
                            : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"}`}
                    >
                        <FileText className="h-4 w-4" /> Check with JD
                    </button>
                </div>

                <div className="h-px bg-gray-100" />

                <SelectField
                    label="Select Resume"
                    value={resumeId}
                    onChange={setResumeId}
                    hint={resumes.length === 0 ? "No resumes found — go to Resume Building first." : undefined}
                >
                    <option value="">— Choose a resume —</option>
                    {resumes.map(r => <option key={r._id} value={r._id}>{r.title}</option>)}
                </SelectField>

                {mode === "quick" ? (
                    <div>
                        <label className="text-[11px] font-semibold text-gray-400 mb-1.5 block tracking-wider uppercase">Job Role</label>
                        <input
                            type="text"
                            placeholder="e.g. Software Engineer, Staff Nurse, Sales Executive"
                            value={jobRole}
                            onChange={e => setJobRole(e.target.value)}
                            onKeyDown={e => e.key === "Enter" && handleAnalyze()}
                            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-700 focus:outline-none focus:border-gray-400 transition"
                        />
                        <p className="text-[11px] text-gray-400 mt-1">Any profession. A JD gives a more exact result.</p>
                    </div>
                ) : (
                    <SelectField
                        label="Select Job Description"
                        value={jdId}
                        onChange={setJdId}
                        hint={jds.length === 0 ? "No JDs found — upload one in Simulations first." : undefined}
                    >
                        <option value="">— Choose a JD —</option>
                        {jds.map(j => <option key={j._id} value={j._id}>{j.title} — {j.company}</option>)}
                    </SelectField>
                )}

                <SelectField label="Scoring style" value={style} onChange={(v) => setStyle(v as ScoringStyle)} hint={styleHint}>
                    {STYLES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </SelectField>

                <button
                    onClick={handleAnalyze}
                    disabled={loading}
                    className="flex items-center justify-center gap-2 bg-black text-white text-sm font-medium px-5 py-2.5 rounded-xl hover:bg-gray-800 transition disabled:opacity-50 disabled:cursor-not-allowed mt-auto"
                >
                    {loading
                        ? <><Loader2 className="h-4 w-4 animate-spin" /> Analyzing...</>
                        : "Analyze Resume"}
                </button>
            </div>

            {/* ── RIGHT PANEL: results, using the full width ── */}
            <div className="min-w-0 flex-1 overflow-y-auto bg-gray-50/40 p-6">
                {!result && !loading && (
                    <div className="flex flex-col items-center justify-center h-full text-gray-300 select-none">
                        <ScanSearch className="h-14 w-14 mb-3" />
                        <p className="text-sm font-medium">Results will appear here</p>
                        <p className="text-xs mt-1">Select a resume and a role or JD, then click Analyze Resume</p>
                    </div>
                )}

                {loading && <Progress />}

                {result && report && (
                    // key: a new result resets the boundary after an earlier one failed.
                    <ReportBoundary key={result.record._id}>
                        <AtsReportView report={report} cached={result.cached} />
                    </ReportBoundary>
                )}

                {result && !report && (
                    <div className="flex h-full flex-col items-center justify-center text-center text-gray-500">
                        <p className="text-sm font-medium">This result came from an older version of the ATS service.</p>
                        <p className="mt-1 text-xs">Restart or redeploy the ATS service, then run the analysis again.</p>
                    </div>
                )}
            </div>
        </div>
    );
}
