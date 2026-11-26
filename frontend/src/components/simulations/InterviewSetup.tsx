import { useEffect, useId, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ArrowRight, FileUp, Loader2 } from "lucide-react";
import type { JobDescription, Resume } from "@/types";
import { errorMessage } from "@/lib/errors";
import { jdToText } from "@/lib/jd";
import { isSaved, normalizeResume, resumeToText } from "@/lib/resume/model";
import Segmented from "./Segmented";

const API = import.meta.env.VITE_API_BASE_URL;
const UPLOAD = "upload";
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

// What each type asks about, as the interview service instructs the interviewer.
const TYPES = [
    { value: "technical_role", label: "Role-based technical", hint: "Skills, tools and design topics the job asks for" },
    { value: "technical_projects", label: "Project deep dive", hint: "Decisions and trade-offs in your resume's projects" },
    { value: "dsa", label: "DSA", hint: "Data structures, algorithms and complexity" },
    { value: "hybrid", label: "Hybrid", hint: "Half DSA, half role-based technical" },
    { value: "hr", label: "HR", hint: "Teamwork, motivation and past experience" },
] as const;

const LEVELS = [
    { value: "easy", label: "Beginner" },
    { value: "medium", label: "Intermediate" },
    { value: "hard", label: "Expert" },
] as const;

// The interview service asks this many questions for each length.
const LENGTHS = [
    { value: "5min", label: "5", questions: 3 },
    { value: "10min", label: "10", questions: 5 },
    { value: "15min", label: "15", questions: 8 },
    { value: "30min", label: "30", questions: 12 },
    { value: "45min", label: "45", questions: 17 },
] as const;

type Settings = { type: string; level: string; length: string };
const DEFAULTS: Settings = { type: "technical_role", level: "medium", length: "15min" };
const STORAGE_KEY = "simulation-settings";

// The last choices, so a repeat session starts where the previous one did.
const loadSettings = (): Settings => {
    try {
        return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") };
    } catch {
        return DEFAULTS;
    }
};

export default function InterviewSetup({ job }: { job: JobDescription | null }) {
    const navigate = useNavigate();
    const resumeId = useId();
    const [settings, setSettings] = useState<Settings>(loadSettings);
    const [resumes, setResumes] = useState<Resume[] | null>(null);
    const [choice, setChoice] = useState<string>(UPLOAD);
    const [file, setFile] = useState<File | null>(null);
    const [starting, setStarting] = useState<"" | "reading" | "starting">("");

    useEffect(() => {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
        } catch {
            // Private windows may refuse storage; the defaults still work.
        }
    }, [settings]);

    useEffect(() => {
        fetch(`${API}/parser/all`, { credentials: "include" })
            .then((res) => res.json())
            .then((data) => {
                const list: Resume[] = (data.resumes || []).map(normalizeResume).filter((r: Resume) => isSaved(r._id));
                setResumes(list);
                if (list.length) setChoice(list[0]._id!);
            })
            .catch(() => setResumes([]));
    }, []);

    const set = (patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch }));
    const length = LENGTHS.find((l) => l.value === settings.length) ?? LENGTHS[2];
    const ready = !!job && (choice !== UPLOAD || !!file) && !starting;

    const start = async () => {
        if (!job || !ready) return;
        try {
            let resumeText: string;
            let savedId: string | undefined;
            if (choice === UPLOAD) {
                if (file!.size > MAX_UPLOAD_BYTES) throw new Error("The file is larger than 4 MB");
                setStarting("reading");
                const form = new FormData();
                form.append("file", file!);
                form.append("title", file!.name.replace(/\.(pdf|tex)$/i, "").replace(/_/g, " "));
                const res = await fetch(`${API}/parser/parse`, { method: "POST", body: form, credentials: "include" });
                const data = await res.json();
                if (!res.ok || !data.success) throw new Error(data.error || "The resume could not be read");
                resumeText = data.resumeText;
                savedId = data.resume?._id;
            } else {
                const resume = resumes?.find((r) => r._id === choice);
                if (!resume) throw new Error("Choose a resume");
                resumeText = resumeToText(resume);
                savedId = resume._id;
            }
            setStarting("starting");
            navigate("/interview", {
                state: {
                    company: job.company,
                    role: job.title,
                    jobDescription: jdToText(job),
                    level: settings.level,
                    duration: settings.length,
                    interviewType: settings.type,
                    resume: resumeText,
                    jdId: job._id,
                    resumeId: savedId,
                },
            });
        } catch (err) {
            toast.error(errorMessage(err, "The interview could not start"));
            setStarting("");
        }
    };

    return (
        <section aria-label="Interview setup" className="relative flex min-h-0 flex-col rounded-2xl border border-gray-200 bg-[#F9F9F9]">
            <h2 className="border-b border-gray-200 px-4 py-3 text-sm font-semibold text-gray-900">Interview setup</h2>

            {/* relative: the visually hidden radio inputs are absolutely positioned,
                and only a positioned scroll container keeps them inside it. */}
            <div className="relative min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
                <fieldset>
                    <legend className="mb-1.5 text-xs font-medium text-gray-500">Type</legend>
                    <div className="space-y-1">
                        {TYPES.map((t) => {
                            const checked = settings.type === t.value;
                            return (
                                <label
                                    key={t.value}
                                    className={`flex cursor-pointer gap-2.5 rounded-xl border px-3 py-2 transition-colors has-focus-visible:ring-2 has-focus-visible:ring-gray-400 ${checked ? "border-gray-900 bg-white" : "border-transparent hover:bg-white/70"
                                        }`}
                                >
                                    <input
                                        type="radio"
                                        name="interview-type"
                                        value={t.value}
                                        checked={checked}
                                        onChange={() => set({ type: t.value })}
                                        className="mt-1 accent-gray-900"
                                    />
                                    <span>
                                        <span className="block text-sm font-medium text-gray-900">{t.label}</span>
                                        <span className="block text-xs text-gray-500">{t.hint}</span>
                                    </span>
                                </label>
                            );
                        })}
                    </div>
                </fieldset>

                <Segmented label="Difficulty" options={LEVELS} value={settings.level as (typeof LEVELS)[number]["value"]} onChange={(level) => set({ level })} />

                <div>
                    <Segmented label="Length in minutes" options={LENGTHS} value={length.value} onChange={(value) => set({ length: value })} />
                    <p className="mt-1 text-xs text-gray-500">About {length.questions} questions.</p>
                </div>

                <div>
                    <label htmlFor={resumeId} className="mb-1.5 block text-xs font-medium text-gray-500">Resume</label>
                    <select
                        id={resumeId}
                        value={choice}
                        disabled={resumes === null}
                        onChange={(e) => setChoice(e.target.value)}
                        className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 outline-none focus:border-gray-400"
                    >
                        {resumes === null && <option value={UPLOAD}>Loading your resumes…</option>}
                        {resumes?.map((r) => (
                            <option key={r._id} value={r._id}>{r.title}</option>
                        ))}
                        {resumes !== null && <option value={UPLOAD}>Upload a new file…</option>}
                    </select>

                    {choice === UPLOAD ? (
                        <label className="mt-2 flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-600 hover:border-gray-500 focus-within:ring-2 focus-within:ring-gray-400">
                            <FileUp size={16} className="shrink-0 text-gray-400" />
                            <span className="truncate">{file ? file.name : "Choose a PDF or .tex file"}</span>
                            <input type="file" accept=".pdf,.tex,application/pdf" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                        </label>
                    ) : (
                        <p className="mt-1 text-xs text-gray-500">From your library. Edit it under Resume Building.</p>
                    )}
                    {choice === UPLOAD && <p className="mt-1 text-xs text-gray-500">It is read, then saved to your library for next time.</p>}
                </div>
            </div>

            <div className="border-t border-gray-200 p-4">
                <button
                    type="button"
                    onClick={start}
                    disabled={!ready}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#252525] py-2.5 text-sm font-medium text-white hover:bg-black disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-600"
                >
                    {starting ? <Loader2 size={16} className="animate-spin" /> : null}
                    {starting === "reading" ? "Reading your resume…" : starting === "starting" ? "Starting…" : "Start interview"}
                    {!starting && <ArrowRight size={16} />}
                </button>
                {!job && <p className="mt-1.5 text-center text-xs text-gray-500">Choose a job first.</p>}
                {job && choice === UPLOAD && !file && <p className="mt-1.5 text-center text-xs text-gray-500">Choose a resume file first.</p>}
            </div>
        </section>
    );
}
