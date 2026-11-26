import { Briefcase, Download, MapPin } from "lucide-react";
import type { JobDescription } from "@/types";

/** The chosen job, with its full description shown in the page. */
export default function JobDetails({ job }: { job: JobDescription | null }) {
    if (!job) {
        return (
            <section aria-label="Job description" className="flex items-center justify-center rounded-2xl border border-gray-200 bg-white p-6 text-sm text-gray-500">
                Choose a job on the left to read its description.
            </section>
        );
    }

    const skills = job.requiredSkills || [];
    const added = job.createdAt ? new Date(job.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "";

    return (
        <section aria-label="Job description" className="flex min-h-0 flex-col rounded-2xl border border-gray-200 bg-white">
            <header className="border-b border-gray-100 px-5 pb-4 pt-4">
                <p className="text-sm text-gray-500">{job.company}</p>
                <h2 className="text-xl font-semibold leading-tight text-gray-900">{job.title}</h2>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-600">
                    <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1"><MapPin size={12} /> {job.location}</span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1"><Briefcase size={12} /> {job.jobType}</span>
                    {added && <span className="text-gray-400">Added {added}</span>}
                </div>
            </header>

            <div className="relative min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
                {skills.length > 0 && (
                    <div>
                        <h3 className="mb-2 text-sm font-semibold text-gray-900">Skills asked for</h3>
                        <ul className="flex flex-wrap gap-1.5">
                            {skills.map((s) => (
                                <li key={s} className="rounded-lg border border-gray-200 px-2 py-0.5 text-xs text-gray-700">{s}</li>
                            ))}
                        </ul>
                    </div>
                )}
                <div>
                    <h3 className="mb-2 text-sm font-semibold text-gray-900">Description</h3>
                    <p className="whitespace-pre-line text-sm leading-relaxed text-gray-700">
                        {job.description?.trim() || "This job description has no text. The original PDF may still have it."}
                    </p>
                </div>
            </div>

            {job.url && (
                <footer className="border-t border-gray-100 px-5 py-2.5">
                    <a href={job.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-900">
                        <Download size={13} /> Download the original PDF
                    </a>
                </footer>
            )}
        </section>
    );
}
