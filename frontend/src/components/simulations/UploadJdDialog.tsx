import { useState } from "react";
import { toast } from "sonner";
import { FileUp } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { JobDescription } from "@/types";

const API = import.meta.env.VITE_API_BASE_URL;
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // the API's limit

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onUploaded: (job: JobDescription) => void;
}

/** Uploads a job description PDF, which the API reads into a title, company, skills and description. */
export default function UploadJdDialog({ open, onOpenChange, onUploaded }: Props) {
    const [file, setFile] = useState<File | null>(null);
    const [progress, setProgress] = useState<number | null>(null);

    const close = () => {
        if (progress !== null) return; // keep it open while uploading
        setFile(null);
        onOpenChange(false);
    };

    const upload = () => {
        if (!file) return;
        if (file.size > MAX_UPLOAD_BYTES) {
            toast.error("The file is larger than 4 MB");
            return;
        }
        const form = new FormData();
        form.append("jd", file);
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `${API}/jd/parse`);
        xhr.withCredentials = true;
        xhr.upload.onprogress = (e) => e.lengthComputable && setProgress(Math.round((e.loaded / e.total) * 100));
        xhr.onload = () => {
            setProgress(null);
            let data: { job?: JobDescription; error?: string; message?: string } = {};
            try {
                data = JSON.parse(xhr.responseText);
            } catch {
                // not JSON; handled below
            }
            if (xhr.status >= 200 && xhr.status < 300 && data.job) {
                toast.success("Job description added");
                setFile(null);
                onUploaded(data.job);
                onOpenChange(false);
            } else {
                toast.error(data.error || data.message || `The upload failed (${xhr.status})`);
            }
        };
        xhr.onerror = () => {
            setProgress(null);
            toast.error("The upload failed. Check your connection.");
        };
        setProgress(0);
        xhr.send(form);
    };

    const uploading = progress !== null;

    return (
        <Dialog open={open} onOpenChange={(next) => !next && close()}>
            <DialogContent className="bg-white sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Upload a job description</DialogTitle>
                    <DialogDescription className="text-gray-600">
                        A PDF up to 4 MB. It is read into a title, company, skills and description.
                    </DialogDescription>
                </DialogHeader>

                <label className={`flex flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center text-sm focus-within:ring-2 focus-within:ring-gray-400 ${uploading ? "border-gray-200 text-gray-400" : "cursor-pointer border-gray-300 text-gray-600 hover:border-gray-500"}`}>
                    <FileUp size={22} className="text-gray-400" />
                    <span className="max-w-full truncate font-medium">{file ? file.name : "Choose a PDF"}</span>
                    {!file && <span className="text-xs text-gray-400">Click to browse</span>}
                    <input type="file" accept="application/pdf" className="sr-only" disabled={uploading} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
                </label>

                {uploading && (
                    <div aria-live="polite">
                        <div className="mb-1 flex justify-between text-xs text-gray-500">
                            <span>{progress < 100 ? "Uploading…" : "Reading the job description…"}</span>
                            <span>{progress}%</span>
                        </div>
                        <div className="h-2 w-full rounded-full bg-gray-200">
                            <div className="h-2 rounded-full bg-gray-900 transition-all" style={{ width: `${progress}%` }} />
                        </div>
                    </div>
                )}

                <div className="flex justify-end gap-2">
                    <button type="button" onClick={close} disabled={uploading} className="rounded-xl border border-gray-300 px-4 py-2 text-sm hover:bg-gray-100 disabled:opacity-50">
                        Cancel
                    </button>
                    <button type="button" onClick={upload} disabled={!file || uploading} className="rounded-xl bg-[#252525] px-4 py-2 text-sm font-medium text-white hover:bg-black disabled:bg-gray-300 disabled:text-gray-600">
                        {uploading ? "Uploading…" : "Upload"}
                    </button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
