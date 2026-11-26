import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { Resume, ResumeLayout } from "@/types";
import { errorMessage } from "@/lib/errors";
import {
    createEmptyResume,
    duplicateResume,
    isSaved,
    normalizeResume,
    snapshot,
    tightenLayout,
} from "@/lib/resume/model";
import PagedPreview from "@/components/Resume/PagedPreview";
import type { PreviewHandle } from "@/components/Resume/PagedPreview";
import PreviewToolbar from "@/components/Resume/PreviewToolbar";
import ResumeEditor from "@/components/Resume/ResumeEditor";
import ResumeList from "@/components/Resume/ResumeList";
import ImportReportDialog from "@/components/Resume/ImportReportDialog";

const API = import.meta.env.VITE_API_BASE_URL;
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // the API's limit

const api = async (path: string, init: RequestInit = {}) => {
    const res = await fetch(`${API}${path}`, {
        credentials: "include",
        ...init,
        headers: init.body && typeof init.body === "string" ? { "Content-Type": "application/json", ...init.headers } : init.headers,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) throw new Error(data.error || data.message || `Request failed (${res.status})`);
    return data;
};

/** The fields a save sends. The server sets the owner, file and import report. */
const body = (r: Resume) => JSON.stringify({ title: r.title, header: r.header, sections: r.sections, layout: r.layout });

export default function ResumeBuilder() {
    const [resumes, setResumes] = useState<Resume[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [editorKey, setEditorKey] = useState(0);
    /** Last saved state of each resume, to tell what has unsaved changes. */
    const [saved, setSaved] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [pageCount, setPageCount] = useState(1);
    const [fitting, setFitting] = useState(false);
    const [focus, setFocus] = useState<{ id: string; nonce: number } | null>(null);
    const [reportFor, setReportFor] = useState<string | null>(null);
    const previewRef = useRef<PreviewHandle>(null);

    const selected = resumes.find((r) => r._id === selectedId) ?? null;
    const dirtyIds = useMemo(
        () => new Set(resumes.filter((r) => saved[r._id!] !== snapshot(r)).map((r) => r._id!)),
        [resumes, saved]
    );

    const remember = (r: Resume) => setSaved((prev) => ({ ...prev, [r._id!]: snapshot(r) }));

    // Read by onPaginated, which the preview calls during its layout pass.
    const fittingRef = useRef(false);
    const setFit = (on: boolean) => {
        fittingRef.current = on;
        setFitting(on);
    };

    const select = (id: string | null) => {
        setSelectedId(id);
        setEditorKey((k) => k + 1);
        setFocus(null);
        setFit(false);
    };

    const addDraft = (title?: string) => {
        const draft = createEmptyResume(title);
        setResumes((prev) => [...prev, draft]);
        remember(draft);
        select(draft._id!);
    };

    useEffect(() => {
        api("/parser/all")
            .then((data) => {
                const list: Resume[] = (data.resumes || []).map(normalizeResume);
                if (!list.length) {
                    addDraft();
                    return;
                }
                setResumes(list);
                setSaved(Object.fromEntries(list.map((r) => [r._id!, snapshot(r)])));
                select(list[0]._id!);
            })
            .catch((err) => {
                toast.error(errorMessage(err, "Could not load your resumes"));
                addDraft();
            })
            .finally(() => setLoading(false));
        // Load once.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const replace = (id: string, next: Resume) => setResumes((prev) => prev.map((r) => (r._id === id ? next : r)));
    const updateSelected = (next: Resume) => selectedId && replace(selectedId, next);
    const setLayout = (layout: ResumeLayout) => selected && updateSelected({ ...selected, layout });

    const save = useCallback(async () => {
        const r = resumes.find((x) => x._id === selectedId);
        if (!r || saving) return;
        setSaving(true);
        try {
            if (isSaved(r._id)) {
                const data = await api(`/parser/update/${r._id}`, { method: "PUT", body: body(r) });
                const stored = normalizeResume(data.updatedResume);
                setSaved((prev) => ({ ...prev, [stored._id!]: snapshot(stored) }));
            } else {
                const data = await api("/parser/create", { method: "POST", body: body(r) });
                const created = normalizeResume(data.resume);
                // Swap the draft for the saved resume, keeping the editor as it is.
                setResumes((prev) => prev.map((x) => (x._id === r._id ? { ...r, _id: created._id, source: created.source } : x)));
                setSaved((prev) => ({ ...prev, [created._id!]: snapshot({ ...r, _id: created._id }) }));
                setSelectedId(created._id!);
            }
            toast.success("Resume saved");
        } catch (err) {
            toast.error(errorMessage(err, "Could not save the resume"));
        } finally {
            setSaving(false);
        }
    }, [resumes, selectedId, saving]);

    // Ctrl/Cmd+S saves, and leaving the page with unsaved changes asks first.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
                e.preventDefault();
                save();
            }
        };
        const onUnload = (e: BeforeUnloadEvent) => {
            if (dirtyIds.size) e.preventDefault();
        };
        window.addEventListener("keydown", onKey);
        window.addEventListener("beforeunload", onUnload);
        return () => {
            window.removeEventListener("keydown", onKey);
            window.removeEventListener("beforeunload", onUnload);
        };
    }, [save, dirtyIds]);

    // "Fit to one page": tighten one notch each time the pages are laid out again,
    // starting from the layout the preview just measured.
    const onPaginated = useCallback((count: number, layout: ResumeLayout) => {
        setPageCount(count);
        if (!fittingRef.current) return;
        const stop = () => {
            fittingRef.current = false;
            setFitting(false);
        };
        if (count <= 1) {
            stop();
            toast.success("The resume fits on one page");
            return;
        }
        const next = tightenLayout(layout);
        if (!next) {
            stop();
            toast.warning(`Still ${count} pages at the tightest settings. Shorten or hide some content.`);
            return;
        }
        setResumes((prev) => prev.map((r) => (r.layout === layout ? { ...r, layout: next } : r)));
    }, []);

    const upload = async (file: File) => {
        if (!/\.(pdf|tex)$/i.test(file.name)) return toast.error("Upload a PDF or a .tex file");
        if (file.size > MAX_UPLOAD_BYTES) return toast.error("The file is larger than 4 MB");
        const form = new FormData();
        form.append("file", file);
        form.append("title", file.name.replace(/\.(pdf|tex)$/i, "").replace(/_/g, " "));
        setUploading(true);
        try {
            const data = await api("/parser/parse", { method: "POST", body: form });
            const imported = normalizeResume(data.resume);
            setResumes((prev) => [...prev, imported]);
            remember(imported);
            select(imported._id!);
            setReportFor(imported._id!);
        } catch (err) {
            toast.error(errorMessage(err, "The resume could not be read"));
        } finally {
            setUploading(false);
        }
    };

    const rename = async (id: string, title: string) => {
        const r = resumes.find((x) => x._id === id);
        if (!r) return;
        replace(id, { ...r, title });
        if (!isSaved(id)) return;
        try {
            await api(`/parser/update/${id}`, { method: "PUT", body: JSON.stringify({ title }) });
            // Only the title is saved; other unsaved edits stay unsaved.
            setSaved((prev) => {
                if (!prev[id]) return prev;
                const [, ...rest] = JSON.parse(prev[id]);
                return { ...prev, [id]: JSON.stringify([title, ...rest]) };
            });
        } catch (err) {
            toast.error(errorMessage(err, "Could not rename the resume"));
        }
    };

    const duplicate = async (id: string) => {
        const r = resumes.find((x) => x._id === id);
        if (!r) return;
        try {
            const data = await api("/parser/create", { method: "POST", body: body(duplicateResume(r)) });
            const copy = normalizeResume(data.resume);
            setResumes((prev) => [...prev, copy]);
            remember(copy);
            select(copy._id!);
            toast.success("Copy saved. Edit it for another job.");
        } catch (err) {
            toast.error(errorMessage(err, "Could not copy the resume"));
        }
    };

    const remove = async (id: string) => {
        try {
            if (isSaved(id)) await api(`/parser/delete/${id}`, { method: "DELETE" });
            const rest = resumes.filter((r) => r._id !== id);
            setResumes(rest);
            if (selectedId === id) {
                if (rest.length) select(rest[0]._id!);
                else addDraft();
            }
            toast.success("Resume deleted");
        } catch (err) {
            toast.error(errorMessage(err, "Could not delete the resume"));
        }
    };

    if (loading || !selected) {
        return <main className="flex h-[calc(99vh-3rem)] items-center justify-center text-sm text-gray-500">Loading your resumes…</main>;
    }

    return (
        <main className="flex gap-4 overflow-hidden bg-white px-6 py-2" style={{ height: "calc(99vh - 3rem)" }}>
            <section aria-label="Preview" className="flex w-1/2 min-w-0 flex-col overflow-hidden rounded-xl border border-gray-200 shadow-sm">
                <PreviewToolbar
                    resume={selected}
                    pageCount={pageCount}
                    dirty={dirtyIds.has(selected._id!)}
                    saving={saving}
                    fitting={fitting}
                    onSave={save}
                    onDownloadPdf={() => previewRef.current?.print()}
                    onLayoutChange={setLayout}
                    onFit={() => {
                        const next = tightenLayout(selected.layout);
                        if (!next) return;
                        setFit(true);
                        setLayout(next);
                    }}
                />
                <div className="min-h-0 flex-1">
                    <PagedPreview
                        ref={previewRef}
                        resume={selected}
                        onLayoutChange={setLayout}
                        onPaginated={onPaginated}
                        onSectionClick={(id) => setFocus({ id, nonce: Date.now() })}
                    />
                </div>
            </section>

            <div className="grid w-1/2 min-w-0 grid-rows-[1fr_230px] gap-4">
                <section aria-label="Editor" className="min-h-0 overflow-hidden rounded-xl border border-[#E5E5E5]">
                    <ResumeEditor key={editorKey} resume={selected} onChange={updateSelected} focus={focus} />
                </section>
                <section aria-label="Resume library" className="min-h-0 overflow-hidden rounded-xl border border-[#E5E5E5]">
                    <ResumeList
                        resumes={resumes}
                        selectedId={selectedId}
                        dirtyIds={dirtyIds}
                        uploading={uploading}
                        onSelect={select}
                        onAdd={() => addDraft(`Resume ${resumes.length + 1}`)}
                        onUpload={upload}
                        onRename={rename}
                        onDuplicate={duplicate}
                        onDelete={remove}
                        onShowReport={setReportFor}
                    />
                </section>
            </div>

            <ImportReportDialog
                resume={resumes.find((r) => r._id === reportFor) ?? null}
                onClose={() => setReportFor(null)}
                onDiscard={(id) => {
                    setReportFor(null);
                    remove(id);
                }}
            />
        </main>
    );
}
