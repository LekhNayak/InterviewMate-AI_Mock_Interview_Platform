import { MapPin, Search, Upload } from "lucide-react";
import type { JobDescription } from "@/types";
import Segmented from "./Segmented";
import { WORK_MODES } from "./workModes";
import type { WorkMode } from "./workModes";

interface Props {
    /** null while loading */
    jobs: JobDescription[] | null;
    filtered: JobDescription[];
    selectedId: string | null;
    onSelect: (id: string) => void;
    search: string;
    setSearch: (value: string) => void;
    mode: WorkMode;
    setMode: (mode: WorkMode) => void;
    onUpload: () => void;
}

const byCompany = (jobs: JobDescription[]) => {
    const groups = new Map<string, JobDescription[]>();
    for (const job of jobs) {
        const key = job.company || "Unknown company";
        groups.set(key, [...(groups.get(key) ?? []), job]);
    }
    return [...groups];
};

export default function JobList({ jobs, filtered, selectedId, onSelect, search, setSearch, mode, setMode, onUpload }: Props) {
    const filtering = search.trim() !== "" || mode !== "All";

    return (
        <section aria-label="Jobs" className="relative flex min-h-0 flex-col rounded-2xl border border-gray-200 bg-[#F9F9F9]">
            <div className="space-y-2 border-b border-gray-200 p-3">
                <label className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 focus-within:border-gray-400">
                    <Search size={15} className="shrink-0 text-gray-400" />
                    <input
                        type="search"
                        aria-label="Search jobs"
                        placeholder="Search role, company or skill"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="w-full bg-transparent text-sm text-gray-800 outline-none placeholder:text-gray-400"
                    />
                </label>
                <Segmented label="Work mode" showLabel={false} options={WORK_MODES.map((m) => ({ value: m, label: m }))} value={mode} onChange={setMode} />
            </div>

            {jobs === null ? (
                <p className="p-4 text-sm text-gray-500">Loading job descriptions…</p>
            ) : jobs.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
                    <p className="text-sm text-gray-600">No job descriptions yet. Upload one to start practising for it.</p>
                    <button type="button" onClick={onUpload} className="inline-flex items-center gap-1.5 rounded-xl bg-[#252525] px-3 py-2 text-sm font-medium text-white hover:bg-black">
                        <Upload size={15} /> Upload JD
                    </button>
                </div>
            ) : filtered.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
                    <p className="text-sm text-gray-600">No jobs match.</p>
                    <button type="button" onClick={() => { setSearch(""); setMode("All"); }} className="text-sm font-medium text-gray-900 underline underline-offset-2">
                        Clear the filters
                    </button>
                </div>
            ) : (
                <>
                    <p className="px-4 pt-2.5 text-xs text-gray-500" aria-live="polite">
                        {filtered.length} {filtered.length === 1 ? "job" : "jobs"}{filtering ? ` of ${jobs.length}` : ""}
                    </p>
                    <ul className="relative min-h-0 flex-1 space-y-3 overflow-y-auto p-2">
                        {byCompany(filtered).map(([company, roles]) => (
                            <li key={company}>
                                <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{company}</p>
                                <ul className="space-y-1">
                                    {roles.map((job) => {
                                        const selected = job._id === selectedId;
                                        return (
                                            <li key={job._id}>
                                                <button
                                                    type="button"
                                                    aria-current={selected ? "true" : undefined}
                                                    onClick={() => onSelect(job._id)}
                                                    className={`w-full rounded-xl px-3 py-2 text-left transition-colors ${selected ? "bg-white shadow-sm ring-1 ring-gray-300" : "hover:bg-white/70"
                                                        }`}
                                                >
                                                    <span className="block truncate text-sm font-medium text-gray-900">{job.title}</span>
                                                    <span className="mt-0.5 flex items-center gap-1 truncate text-xs text-gray-500">
                                                        <MapPin size={11} className="shrink-0" /> {job.location} · {job.jobType}
                                                    </span>
                                                </button>
                                            </li>
                                        );
                                    })}
                                </ul>
                            </li>
                        ))}
                    </ul>
                </>
            )}
        </section>
    );
}
