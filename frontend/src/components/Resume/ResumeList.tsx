import { useEffect, useRef, useState } from "react";
import { FileCode, FilePlus, FileText, Loader2, MoreVertical, PenLine, Upload } from "lucide-react";
import type { Resume } from "@/types";

interface Props {
    resumes: Resume[];
    selectedId: string | null;
    dirtyIds: Set<string>;
    uploading: boolean;
    onSelect: (id: string) => void;
    onAdd: () => void;
    onUpload: (file: File) => void;
    onRename: (id: string, title: string) => void;
    onDuplicate: (id: string) => void;
    onDelete: (id: string) => void;
    onShowReport: (id: string) => void;
}

const sourceLine = (r: Resume) => {
    if (r.source === "pdf") return { icon: <FileText size={12} />, text: `From ${r.sourceName || "a PDF"}` };
    if (r.source === "tex") return { icon: <FileCode size={12} />, text: `From ${r.sourceName || "a .tex file"}` };
    return { icon: <PenLine size={12} />, text: "Made in the builder" };
};

const menuItem = "w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-100";

const ResumeMenu = ({ resume, onRename, onDuplicate, onDelete, onShowReport, onClose }: {
    resume: Resume;
    onRename: (title: string) => void;
    onDuplicate: () => void;
    onDelete: () => void;
    onShowReport: () => void;
    onClose: () => void;
}) => {
    const ref = useRef<HTMLDivElement>(null);
    const [mode, setMode] = useState<"menu" | "rename" | "delete">("menu");
    const [title, setTitle] = useState(resume.title);

    useEffect(() => {
        const onDown = (e: MouseEvent) => {
            if (!ref.current?.parentElement?.contains(e.target as Node)) onClose();
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        document.addEventListener("mousedown", onDown);
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("mousedown", onDown);
            document.removeEventListener("keydown", onKey);
        };
    }, [onClose]);

    const rename = () => {
        if (title.trim()) onRename(title.trim());
        onClose();
    };

    return (
        <div ref={ref} role="menu" className="absolute right-2 top-11 z-20 w-48 rounded-xl border border-gray-200 bg-white py-1 shadow-lg">
            {mode === "rename" && (
                <div className="space-y-1.5 px-3 py-2">
                    <input
                        autoFocus
                        aria-label="New title"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && rename()}
                        className="w-full rounded-lg border border-gray-300 px-2 py-1 text-sm outline-none focus:border-gray-500"
                    />
                    <div className="flex gap-1">
                        <button type="button" onClick={rename} className="rounded-lg bg-black px-2.5 py-1 text-xs text-white">Save</button>
                        <button type="button" onClick={() => setMode("menu")} className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs text-gray-600">Cancel</button>
                    </div>
                </div>
            )}
            {mode === "delete" && (
                <div className="px-3 py-2">
                    <p className="mb-1.5 text-xs text-gray-600">Delete “{resume.title}”?</p>
                    <div className="flex gap-1">
                        <button type="button" onClick={() => { onDelete(); onClose(); }} className="rounded-lg bg-red-600 px-2.5 py-1 text-xs text-white">Delete</button>
                        <button type="button" onClick={() => setMode("menu")} className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs text-gray-600">Cancel</button>
                    </div>
                </div>
            )}
            {mode === "menu" && (
                <>
                    <button type="button" role="menuitem" className={menuItem} onClick={() => setMode("rename")}>Rename</button>
                    <button type="button" role="menuitem" className={menuItem} onClick={() => { onDuplicate(); onClose(); }}>Duplicate</button>
                    {resume.importReport && (
                        <button type="button" role="menuitem" className={menuItem} onClick={() => { onShowReport(); onClose(); }}>Import report</button>
                    )}
                    <button type="button" role="menuitem" className={`${menuItem} text-red-600 hover:bg-red-50`} onClick={() => setMode("delete")}>Delete</button>
                </>
            )}
        </div>
    );
};

export default function ResumeList({
    resumes, selectedId, dirtyIds, uploading, onSelect, onAdd, onUpload, onRename, onDuplicate, onDelete, onShowReport,
}: Props) {
    const [menuFor, setMenuFor] = useState<string | null>(null);

    return (
        <div className="flex h-full flex-col bg-neutral-50/60">
            <div className="border-b border-gray-200/60 px-4 py-2.5">
                <h2 className="text-xs font-medium uppercase tracking-wide text-gray-500">Resume library</h2>
            </div>

            <ul className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
                {resumes.map((r) => {
                    const source = sourceLine(r);
                    const selected = selectedId === r._id;
                    return (
                        <li key={r._id} className="relative">
                            <button
                                type="button"
                                aria-current={selected ? "true" : undefined}
                                onClick={() => onSelect(r._id!)}
                                className={`w-full rounded-xl border px-3 py-2.5 pr-10 text-left transition-colors ${selected
                                    ? "border-blue-300/80 bg-blue-50/60"
                                    : "border-gray-200/70 bg-white/80 hover:border-gray-300/70 hover:bg-gray-50/70"
                                    }`}
                            >
                                <span className="flex items-center gap-1.5 text-sm font-medium text-gray-800">
                                    <span className="truncate">{r.title || "Untitled Resume"}</span>
                                    {dirtyIds.has(r._id!) && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" title="Unsaved changes" aria-label="Unsaved changes" />}
                                </span>
                                <span className="mt-0.5 flex items-center gap-1 truncate text-xs text-gray-500">{source.icon} {source.text}</span>
                            </button>
                            <button
                                type="button"
                                aria-label={`Options for ${r.title}`}
                                aria-haspopup="menu"
                                aria-expanded={menuFor === r._id}
                                onClick={() => setMenuFor(menuFor === r._id ? null : r._id!)}
                                className="absolute right-2 top-2.5 rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                            >
                                <MoreVertical size={16} />
                            </button>
                            {menuFor === r._id && (
                                <ResumeMenu
                                    resume={r}
                                    onRename={(title) => onRename(r._id!, title)}
                                    onDuplicate={() => onDuplicate(r._id!)}
                                    onDelete={() => onDelete(r._id!)}
                                    onShowReport={() => onShowReport(r._id!)}
                                    onClose={() => setMenuFor(null)}
                                />
                            )}
                        </li>
                    );
                })}
            </ul>

            <div className="flex gap-2 border-t border-gray-200/70 bg-white/70 p-3">
                <button type="button" onClick={onAdd} className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-dashed border-gray-400/70 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100/70">
                    <FilePlus size={15} /> New resume
                </button>
                <label className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-dashed border-gray-400/70 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100/70 focus-within:ring-2 focus-within:ring-gray-400 ${uploading ? "pointer-events-none opacity-60" : "cursor-pointer"}`}>
                    {uploading ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
                    {uploading ? "Reading your resume…" : "Upload PDF or .tex"}
                    <input
                        type="file"
                        accept=".pdf,.tex,application/pdf"
                        className="sr-only"
                        disabled={uploading}
                        onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) onUpload(file);
                            e.target.value = ""; // allow the same file again
                        }}
                    />
                </label>
            </div>
        </div>
    );
}
