import { useRef } from "react";
import { AlertTriangle, CheckCircle2, ExternalLink } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ImportReport, Resume } from "@/types";
import { KIND_LABELS, PRESET_LABELS } from "@/lib/resume/model";

interface Props {
    resume: Resume | null;
    onClose: () => void;
    onDiscard: (id: string) => void;
}

const placedAs = (s: ImportReport["sections"][number]) =>
    s.kind === "entries" && s.preset ? `${PRESET_LABELS[s.preset]} entries` : KIND_LABELS[s.kind];

const UNITS = { text: ["paragraph", "paragraphs"], entries: ["entry", "entries"], skills: ["group", "groups"], list: ["item", "items"] };
const countLabel = (s: ImportReport["sections"][number]) => `${s.count} ${UNITS[s.kind][s.count === 1 ? 0 : 1]}`;

/** What the importer read from an uploaded file, and what it could not place. */
export default function ImportReportDialog({ resume, onClose, onDiscard }: Props) {
    const keepRef = useRef<HTMLButtonElement>(null);
    const report = resume?.importReport;
    const percent = report && report.checkedLines ? Math.round((report.matchedLines / report.checkedLines) * 100) : 100;
    const complete = report && !report.missed.length && !report.missingHeadings.length && !report.truncated;

    return (
        <Dialog open={!!report} onOpenChange={(open) => !open && onClose()}>
            {report && resume && (
                <DialogContent
                    className="bg-white sm:max-w-2xl max-h-[85vh] overflow-y-auto"
                    // Start on the safe choice, not on "Discard import".
                    onOpenAutoFocus={(e) => {
                        e.preventDefault();
                        keepRef.current?.focus();
                    }}
                >
                    <DialogHeader>
                        <DialogTitle>What we read from {report.fileName}</DialogTitle>
                        <DialogDescription className="text-gray-600">
                            Check the sections below against your file, then edit anything in the builder.
                        </DialogDescription>
                    </DialogHeader>

                    <div className={`flex gap-2 rounded-lg p-3 text-sm ${complete ? "bg-green-50 text-green-900" : "bg-amber-50 text-amber-900"}`}>
                        {complete ? <CheckCircle2 size={18} className="mt-0.5 shrink-0" /> : <AlertTriangle size={18} className="mt-0.5 shrink-0" />}
                        <p>
                            {report.checkedLines
                                ? <>The text of {report.matchedLines} of {report.checkedLines} lines in your file is in this resume ({percent}%).</>
                                : <>Your file had too little text to compare line by line.</>}
                            {complete ? " Nothing was left out." : " Look at the parts listed below."}
                        </p>
                    </div>

                    <section aria-labelledby="report-sections">
                        <h3 id="report-sections" className="mb-1.5 text-sm font-semibold">Sections found</h3>
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b text-left text-xs text-gray-500">
                                    <th className="py-1.5 font-medium">Heading in your file</th>
                                    <th className="py-1.5 font-medium">Placed as</th>
                                    <th className="py-1.5 text-right font-medium">Contents</th>
                                </tr>
                            </thead>
                            <tbody>
                                {report.sections.map((s, i) => (
                                    <tr key={i} className="border-b border-gray-100">
                                        <td className="py-1.5 font-medium">{s.heading || "Untitled"}</td>
                                        <td className="py-1.5 text-gray-600">{placedAs(s)}</td>
                                        <td className="py-1.5 text-right tabular-nums text-gray-600">{countLabel(s)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </section>

                    {report.missingHeadings.length > 0 && (
                        <section aria-labelledby="report-headings">
                            <h3 id="report-headings" className="mb-1 text-sm font-semibold">Headings in your file with no section here</h3>
                            <p className="text-sm text-gray-700">{report.missingHeadings.join(", ")}</p>
                        </section>
                    )}

                    {report.missed.length > 0 && (
                        <section aria-labelledby="report-missed">
                            <h3 id="report-missed" className="mb-1 text-sm font-semibold">Lines we could not place</h3>
                            <p className="mb-1.5 text-xs text-gray-500">Most of their words are not in this resume. Add any you need with “Add section” or inside a section.</p>
                            <ul className="space-y-1 rounded-lg bg-gray-50 p-2.5 text-sm text-gray-800">
                                {report.missed.map((line, i) => <li key={i}>{line}</li>)}
                            </ul>
                        </section>
                    )}

                    {report.truncated && (
                        <p className="text-sm text-amber-800">Your file was longer than the reader takes at once, so its end was cut off.</p>
                    )}

                    <DialogFooter className="gap-2 sm:justify-between">
                        {resume.pdfUrl ? (
                            <a href={resume.pdfUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-gray-600 underline-offset-2 hover:underline">
                                <ExternalLink size={14} /> Open the original PDF
                            </a>
                        ) : <span />}
                        <div className="flex gap-2">
                            <button type="button" className="rounded-lg px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50" onClick={() => onDiscard(resume._id!)}>
                                Discard import
                            </button>
                            <button ref={keepRef} type="button" className="rounded-lg bg-[#252525] px-3 py-1.5 text-sm font-medium text-white hover:bg-black" onClick={onClose}>
                                Keep and edit
                            </button>
                        </div>
                    </DialogFooter>
                </DialogContent>
            )}
        </Dialog>
    );
}
