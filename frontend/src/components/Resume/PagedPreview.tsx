import { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, PointerEvent, Ref } from "react";
import { createPortal } from "react-dom";
import type { Resume, ResumeLayout } from "@/types";
import { clampLayoutValue, fileNameFor } from "@/lib/resume/model";
import { buildBlocks, RESUME_CSS } from "./resumeBlocks";
import type { Block } from "./resumeBlocks";

// The resume on A4 pages, as it will print. Blocks are measured at full size in a
// hidden copy, placed on pages, and the pages are scaled to fit the panel.
// "Download PDF" prints these same pages, so the file matches the preview.

const PX_PER_MM = 96 / 25.4;
const PX_PER_PT = 96 / 72;
const PAGE_W = 210 * PX_PER_MM;
const PAGE_H = 297 * PX_PER_MM;
const PAGE_GAP = 24; // px between pages on screen

export interface PreviewHandle {
    print: () => void;
}

interface Props {
    resume: Resume;
    onLayoutChange: (layout: ResumeLayout) => void;
    /** After every layout pass, with the layout it measured. */
    onPaginated?: (pageCount: number, layout: ResumeLayout) => void;
    onSectionClick?: (sectionId: string) => void;
    ref?: Ref<PreviewHandle>;
}

/** Block indexes on each page. A block that does not fit starts a new page. */
const paginate = (blocks: Block[], heights: number[], pageHeight: number) => {
    const pages: number[][] = [[]];
    let y = 0;
    for (let i = 0; i < blocks.length; i++) {
        const page = pages[pages.length - 1];
        const space = page.length ? blocks[i].space * PX_PER_PT : 0;
        // A heading or entry title needs room for what it is kept with.
        let need = space + heights[i];
        for (let j = i; blocks[j].keepWithNext && j + 1 < blocks.length; j++) {
            need += blocks[j + 1].space * PX_PER_PT + heights[j + 1];
        }
        if (page.length && y + Math.min(need, pageHeight) > pageHeight + 0.5) {
            pages.push([i]);
            y = heights[i];
        } else {
            page.push(i);
            y += space + heights[i];
        }
    }
    return pages;
};

const docStyle = (layout: ResumeLayout): CSSProperties =>
    ({ "--rz-fs": `${layout.fontSize}pt`, "--rz-lh": layout.lineHeight } as CSSProperties);

const GAP_LABEL = { section: "Space between sections", entry: "Space between entries" } as const;

/** Drag, or focus and use the arrow keys, to change a gap everywhere in the resume. */
const GapHandle = ({ block, layout, scale, onLayoutChange }: {
    block: Block;
    layout: ResumeLayout;
    scale: number;
    onLayoutChange: (layout: ResumeLayout) => void;
}) => {
    const key = block.gap === "section" ? "sectionGap" : "entryGap";
    const [dragging, setDragging] = useState(false);
    const height = block.space * PX_PER_PT;

    const set = (value: number) => onLayoutChange({ ...layout, [key]: clampLayoutValue(key, value) });

    const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        const startY = e.clientY;
        const start = layout[key];
        const el = e.currentTarget;
        el.setPointerCapture(e.pointerId);
        setDragging(true);
        const move = (ev: globalThis.PointerEvent) => set(start + (ev.clientY - startY) / scale / PX_PER_PT);
        const up = () => {
            setDragging(false);
            el.removeEventListener("pointermove", move);
            el.removeEventListener("pointerup", up);
            el.removeEventListener("pointercancel", up);
        };
        el.addEventListener("pointermove", move);
        el.addEventListener("pointerup", up);
        el.addEventListener("pointercancel", up);
    };

    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        const delta = { ArrowUp: -1, ArrowDown: 1 }[e.key];
        if (delta) {
            e.preventDefault();
            set(layout[key] + delta);
        }
    };

    return (
        <div
            role="separator"
            aria-orientation="horizontal"
            aria-label={`${GAP_LABEL[block.gap!]}: drag or use the arrow keys`}
            aria-valuenow={layout[key]}
            tabIndex={0}
            className={`rz-gap ${dragging ? "rz-gap-active" : ""}`}
            style={{ height: Math.max(height, 10), top: height < 10 ? (height - 10) / 2 : 0 }}
            onPointerDown={onPointerDown}
            onKeyDown={onKeyDown}
            onClick={(e) => e.stopPropagation()}
        >
            <span className="rz-gap-label">{GAP_LABEL[block.gap!]}: {layout[key]}pt</span>
        </div>
    );
};

const Pages = ({ resume, pages, scale, interactive, onLayoutChange, onSectionClick }: {
    resume: Resume;
    pages: Block[][];
    scale: number;
    interactive: boolean;
    onLayoutChange: (layout: ResumeLayout) => void;
    onSectionClick?: (sectionId: string) => void;
}) => (
    <>
        {pages.map((page, n) => (
            <div
                key={n}
                className="rz-page"
                style={{ width: PAGE_W, height: PAGE_H, padding: `${resume.layout.margin}mm`, marginBottom: interactive ? PAGE_GAP : 0 }}
                aria-label={interactive ? `Page ${n + 1} of ${pages.length}` : undefined}
            >
                <div className="rz-doc" style={docStyle(resume.layout)}>
                    {page.map((block, pos) => {
                        const showGap = interactive && block.gap && pos > 0;
                        return (
                            <div
                                key={block.key}
                                className={interactive && block.sectionId ? "rz-block rz-editable" : "rz-block"}
                                style={{ paddingTop: pos > 0 ? `${block.space}pt` : 0 }}
                                onClick={interactive && block.sectionId ? () => onSectionClick?.(block.sectionId!) : undefined}
                            >
                                {showGap && <GapHandle block={block} layout={resume.layout} scale={scale} onLayoutChange={onLayoutChange} />}
                                {block.node}
                            </div>
                        );
                    })}
                </div>
                {interactive && pages.length > 1 && (
                    <div className="rz-page-number">{n + 1} / {pages.length}</div>
                )}
            </div>
        ))}
    </>
);

const PREVIEW_CSS = `
${RESUME_CSS}
.rz-page { position: relative; box-sizing: border-box; background: #fff; overflow: visible; }
.rz-pages .rz-page { box-shadow: 0 1px 3px rgba(0,0,0,.12), 0 4px 16px rgba(0,0,0,.06); }
.rz-block { position: relative; display: flow-root; }
.rz-editable { cursor: pointer; }
.rz-editable:hover > :last-child { background: rgba(59,130,246,.06); }
.rz-page-number { position: absolute; right: 0; bottom: -20px; font: 12px system-ui, sans-serif; color: #9ca3af; }
.rz-gap { position: absolute; left: -12px; right: -12px; z-index: 2; cursor: ns-resize; outline: none;
  border-top: 1px dashed transparent; border-bottom: 1px dashed transparent; }
.rz-pages:hover .rz-gap { border-color: rgba(59,130,246,.25); }
.rz-gap:hover, .rz-gap:focus-visible, .rz-gap-active { background: rgba(59,130,246,.10); border-color: #3b82f6 !important; }
.rz-gap-label { display: none; position: absolute; right: 12px; top: 50%; transform: translateY(-50%);
  font: 600 11px system-ui, sans-serif; color: #fff; background: #3b82f6; border-radius: 4px; padding: 1px 6px; white-space: nowrap; }
.rz-gap:hover .rz-gap-label, .rz-gap:focus-visible .rz-gap-label, .rz-gap-active .rz-gap-label { display: block; }
`;

const PRINT_CSS = `
${RESUME_CSS}
@media screen { .rz-print { display: none; } }
@media print {
  @page { size: A4; margin: 0; }
  html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; height: auto !important; overflow: visible !important; }
  body > *:not(.rz-print) { display: none !important; }
  .rz-page { position: relative; box-sizing: border-box; background: #fff; overflow: hidden; break-after: page; height: 296.9mm !important; }
  .rz-page:last-child { break-after: auto; }
  .rz-block { position: relative; display: flow-root; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
`;

export default function PagedPreview({ resume, onLayoutChange, onPaginated, onSectionClick, ref }: Props) {
    const { layout } = resume;
    const blocks = useMemo(() => buildBlocks(resume), [resume]);
    const measureRef = useRef<HTMLDivElement>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    // The keys of the blocks on each page. Keys, not positions: after an edit,
    // one render uses the previous pages with the new blocks, and a removed
    // block must then be skipped rather than read past the end of the list.
    const [pageKeys, setPageKeys] = useState<string[][]>([]);
    const [scale, setScale] = useState(0.6);
    const [fontsReady, setFontsReady] = useState(false);
    const [printing, setPrinting] = useState(false);

    const onPaginatedRef = useRef(onPaginated);
    useEffect(() => {
        onPaginatedRef.current = onPaginated;
    });

    useEffect(() => {
        document.fonts?.ready.then(() => setFontsReady(true));
    }, []);

    // Measure every block at full size, then place them on pages.
    useLayoutEffect(() => {
        const el = measureRef.current;
        if (!el) return;
        const heights = Array.from(el.children, (c) => c.getBoundingClientRect().height);
        const next = paginate(blocks, heights, PAGE_H - 2 * layout.margin * PX_PER_MM).map((page) => page.map((i) => blocks[i].key));
        setPageKeys((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
        onPaginatedRef.current?.(next.length, layout);
    }, [blocks, layout, fontsReady]);

    const pages = useMemo(() => {
        const byKey = new Map(blocks.map((b) => [b.key, b]));
        return pageKeys.map((page) => page.flatMap((key) => byKey.get(key) ?? []));
    }, [blocks, pageKeys]);

    // Fit the page width to the panel.
    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;
        const observer = new ResizeObserver(([entry]) => {
            setScale(Math.min(1, Math.max(0.3, (entry.contentRect.width - 32) / PAGE_W)));
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    useImperativeHandle(ref, () => ({ print: () => setPrinting(true) }), []);

    // Print once the unscaled copy is on the page; the browser saves it as a PDF.
    useEffect(() => {
        if (!printing) return;
        const title = document.title;
        document.title = fileNameFor(resume); // the browser's default file name
        const done = () => {
            document.title = title;
            setPrinting(false);
        };
        window.addEventListener("afterprint", done, { once: true });
        const frame = requestAnimationFrame(() => window.print());
        return () => {
            cancelAnimationFrame(frame);
            window.removeEventListener("afterprint", done);
        };
        // Only when a print is requested.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [printing]);

    const stackHeight = pages.length * PAGE_H + Math.max(0, pages.length - 1) * PAGE_GAP;

    return (
        <div ref={scrollRef} className="h-full overflow-y-auto overflow-x-hidden bg-neutral-100 py-5">
            <style>{PREVIEW_CSS}</style>

            {/* Hidden full-size copy, used only for measuring. */}
            <div
                ref={measureRef}
                aria-hidden
                className="rz-doc"
                style={{
                    ...docStyle(layout),
                    position: "absolute",
                    visibility: "hidden",
                    pointerEvents: "none",
                    left: -100000,
                    top: 0,
                    width: PAGE_W - 2 * layout.margin * PX_PER_MM,
                }}
            >
                {blocks.map((b) => (
                    <div key={b.key} className="rz-block">{b.node}</div>
                ))}
            </div>

            <div className="relative mx-auto" style={{ width: PAGE_W * scale, height: stackHeight * scale }}>
                <div className="rz-pages" style={{ width: PAGE_W, transform: `scale(${scale})`, transformOrigin: "top left" }}>
                    <Pages
                        resume={resume}
                        pages={pages}
                        scale={scale}
                        interactive
                        onLayoutChange={onLayoutChange}
                        onSectionClick={onSectionClick}
                    />
                </div>
            </div>

            {blocks.length === 1 && (
                <p className="mt-4 text-center text-sm text-gray-500">
                    Fill in the sections on the right. The pages update as you type.
                </p>
            )}

            {printing &&
                createPortal(
                    <div className="rz-print">
                        <style>{PRINT_CSS}</style>
                        <Pages resume={resume} pages={pages} scale={1} interactive={false} onLayoutChange={onLayoutChange} />
                    </div>,
                    document.body
                )}
        </div>
    );
}
