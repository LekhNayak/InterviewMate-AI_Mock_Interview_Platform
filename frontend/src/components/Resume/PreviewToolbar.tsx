import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { ChevronDown, Download, FileCode, Save, SlidersHorizontal } from "lucide-react";
import type { Resume, ResumeLayout } from "@/types";
import { DEFAULT_LAYOUT, LAYOUT_CONTROLS, clampLayoutValue, fileNameFor } from "@/lib/resume/model";
import { downloadLatex, generateLatex, openInOverleaf } from "@/lib/resume/latex";

interface Props {
    resume: Resume;
    pageCount: number;
    dirty: boolean;
    saving: boolean;
    fitting: boolean;
    onSave: () => void;
    onDownloadPdf: () => void;
    onLayoutChange: (layout: ResumeLayout) => void;
    onFit: () => void;
}

const toolButton =
    "inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:hover:bg-white";

/** A button that opens a small panel; Escape or a click outside closes it. */
const Popover = ({ label, icon, children }: { label: string; icon: ReactNode; children: (close: () => void) => ReactNode }) => {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => {
            if (!ref.current?.contains(e.target as Node)) setOpen(false);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") setOpen(false);
        };
        document.addEventListener("mousedown", onDown);
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("mousedown", onDown);
            document.removeEventListener("keydown", onKey);
        };
    }, [open]);

    return (
        <div ref={ref} className="relative">
            <button type="button" className={toolButton} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(!open)}>
                {icon} {label} <ChevronDown size={13} className="text-gray-400" />
            </button>
            {open && (
                <div role="dialog" aria-label={label} className="absolute right-0 top-full z-30 mt-1.5 w-72 rounded-xl border border-gray-200 bg-white p-3 shadow-lg">
                    {children(() => setOpen(false))}
                </div>
            )}
        </div>
    );
};

const LayoutSlider = ({ control, layout, onLayoutChange }: {
    control: (typeof LAYOUT_CONTROLS)[number];
    layout: ResumeLayout;
    onLayoutChange: (layout: ResumeLayout) => void;
}) => {
    const id = useId();
    const value = layout[control.key];
    return (
        <div>
            <div className="flex justify-between text-xs">
                <label htmlFor={id} className="text-gray-600">{control.label}</label>
                <span className="tabular-nums text-gray-900">{value}{control.unit}</span>
            </div>
            <input
                id={id}
                type="range"
                min={control.min}
                max={control.max}
                step={control.step}
                value={value}
                aria-valuetext={`${value} ${control.unit}`}
                onChange={(e) => onLayoutChange({ ...layout, [control.key]: clampLayoutValue(control.key, Number(e.target.value)) })}
                className="w-full accent-gray-900"
            />
        </div>
    );
};

let printTipShown = false;

export default function PreviewToolbar({ resume, pageCount, dirty, saving, fitting, onSave, onDownloadPdf, onLayoutChange, onFit }: Props) {
    const name = fileNameFor(resume);

    return (
        <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 bg-white px-3 py-2">
            <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-gray-900">{resume.title}</p>
                <p className="text-xs text-gray-500" aria-live="polite">
                    {pageCount} {pageCount === 1 ? "page" : "pages"}, A4
                    {dirty && <span className="font-medium text-amber-700"> · Unsaved changes</span>}
                </p>
            </div>

            <Popover label="Layout" icon={<SlidersHorizontal size={15} />}>
                {() => (
                    <div className="space-y-3">
                        {LAYOUT_CONTROLS.map((c) => (
                            <LayoutSlider key={c.key} control={c} layout={resume.layout} onLayoutChange={onLayoutChange} />
                        ))}
                        <div className="flex gap-2 pt-1">
                            <button type="button" className={`${toolButton} flex-1 justify-center`} disabled={pageCount <= 1 || fitting} onClick={onFit}>
                                {fitting ? "Fitting…" : "Fit to one page"}
                            </button>
                            <button type="button" className={toolButton} onClick={() => onLayoutChange({ ...DEFAULT_LAYOUT })}>Reset</button>
                        </div>
                        <p className="text-xs text-gray-500">You can also drag the gaps between sections and entries in the preview.</p>
                    </div>
                )}
            </Popover>

            <Popover label="LaTeX" icon={<FileCode size={15} />}>
                {(close) => (
                    <div className="space-y-1">
                        <button type="button" className="w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-gray-100" onClick={() => { downloadLatex(generateLatex(resume), name); close(); }}>
                            Download .tex
                        </button>
                        <button type="button" className="w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-gray-100" onClick={() => { openInOverleaf(generateLatex(resume), name); close(); }}>
                            Open in Overleaf
                        </button>
                        <p className="px-2 pt-1 text-xs text-gray-500">Overleaf opens it as a new project and compiles it. It needs a free Overleaf account.</p>
                    </div>
                )}
            </Popover>

            <button
                type="button"
                className={toolButton}
                title="Opens the print dialog. Choose Save as PDF."
                onClick={() => {
                    if (!printTipShown) {
                        toast.info("In the print dialog, choose “Save as PDF” as the destination.");
                        printTipShown = true;
                    }
                    onDownloadPdf();
                }}
            >
                <Download size={15} /> PDF
            </button>

            <button
                type="button"
                onClick={onSave}
                disabled={!dirty || saving}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#252525] px-3 py-1.5 text-sm font-medium text-white hover:bg-black disabled:bg-gray-300 disabled:text-gray-600"
            >
                <Save size={15} /> {saving ? "Saving…" : dirty ? "Save" : "Saved"}
            </button>
        </div>
    );
}
