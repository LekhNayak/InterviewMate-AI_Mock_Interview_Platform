import { useEffect, useState } from "react";
import { invalidate, queryKeys, useJds } from "@/lib/queries";
import { queryClient } from "@/lib/queryClient";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { FolderOpen, MessageSquareText, Upload } from "lucide-react";
import type { JobDescription } from "@/types";
import { useFillViewport } from "@/hooks/useFillViewport";
import JobList from "@/components/simulations/JobList";
import JobDetails from "@/components/simulations/JobDetails";
import InterviewSetup from "@/components/simulations/InterviewSetup";
import UploadJdDialog from "@/components/simulations/UploadJdDialog";
import type { WorkMode } from "@/components/simulations/workModes";


interface SimulationsProps {
    search: string;
    setSearch: React.Dispatch<React.SetStateAction<string>>;
}

const linkButton =
    "inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50";

/**
 * Pick a job, read it, set up the interview and start, on one screen.
 * The page fits the window; each column scrolls on its own.
 */
export default function Simulations({ search, setSearch }: SimulationsProps) {
    const fillRef = useFillViewport<HTMLDivElement>();
    const { data, isError } = useJds<JobDescription>();
    const jobs = isError ? [] : data ?? null;
    const [mode, setMode] = useState<WorkMode>("All");
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [uploadOpen, setUploadOpen] = useState(false);

    useEffect(() => {
        if (isError) toast.error("Could not load the job descriptions");
    }, [isError]);

    const query = search.trim().toLowerCase();
    const filtered = (jobs ?? []).filter(
        (j) =>
            (mode === "All" || j.jobType === mode) &&
            (!query || [j.title, j.company, ...(j.requiredSkills || [])].some((s) => s?.toLowerCase().includes(query)))
    );
    const selected = filtered.find((j) => j._id === selectedId) ?? filtered[0] ?? null;

    return (
        <div ref={fillRef} className="relative flex flex-col gap-3 overflow-hidden px-4 pb-4 pt-3">
            <header className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-xl font-semibold text-gray-900">Simulations</h1>
                    <p className="text-sm text-gray-500">Choose a job, set up the interview, then start.</p>
                </div>
                <nav aria-label="Simulation pages" className="flex items-center gap-2">
                    <Link to="/jd/onboarding" className={linkButton}><FolderOpen size={15} /> My uploads</Link>
                    <Link to="/reviews" className={linkButton}><MessageSquareText size={15} /> Reviews</Link>
                    <button
                        type="button"
                        onClick={() => setUploadOpen(true)}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-[#252525] px-3 py-2 text-sm font-medium text-white hover:bg-black"
                    >
                        <Upload size={15} /> Upload JD
                    </button>
                </nav>
            </header>

            <div className="grid min-h-0 flex-1 grid-cols-[minmax(240px,290px)_minmax(0,1fr)_minmax(280px,320px)] gap-3">
                <JobList
                    jobs={jobs}
                    filtered={filtered}
                    selectedId={selected?._id ?? null}
                    onSelect={setSelectedId}
                    search={search}
                    setSearch={setSearch}
                    mode={mode}
                    setMode={setMode}
                    onUpload={() => setUploadOpen(true)}
                />
                <JobDetails job={selected} />
                <InterviewSetup job={selected} />
            </div>

            <UploadJdDialog
                open={uploadOpen}
                onOpenChange={setUploadOpen}
                onUploaded={(job) => {
                    queryClient.setQueryData<JobDescription[]>(queryKeys.jds, (prev) => [job, ...(prev ?? [])]);
                    invalidate(queryKeys.myJds);
                    setSearch("");
                    setMode("All");
                    setSelectedId(job._id);
                }}
            />
        </div>
    );
}
