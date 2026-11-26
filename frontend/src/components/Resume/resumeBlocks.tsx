import type { ReactNode } from "react";
import type { Resume, ResumeEntry, ResumeLayout, ResumeSection } from "@/types";
import { displayUrl, hrefFor } from "@/lib/resume/model";

// A resume as a list of blocks: the pieces pagination places on pages.
// A block never splits across pages; an entry's title stays with its first bullet.

export type GapKind = "section" | "entry";

export interface Block {
    key: string;
    node: ReactNode;
    /** Space above, in pt. Dropped when the block starts a page. */
    space: number;
    /** Goes to the next page together with the block after it. */
    keepWithNext?: boolean;
    /** The layout setting the space above comes from, for the drag handle. */
    gap?: GapKind;
    sectionId?: string;
}

const nonEmpty = (list: string[]) => list.map((s) => s.trim()).filter(Boolean);

const bullet = (key: string, text: string, sectionId: string, space = 0): Block => ({
    key,
    space,
    sectionId,
    node: <div className="rz-bullet">{text}</div>,
});

const entryBlocks = (e: ResumeEntry, index: number, sectionId: string, layout: ResumeLayout): Block[] => {
    const bullets = nonEmpty(e.bullets);
    const hasTop = e.title.trim() || e.date.trim();
    const hasSub = e.subtitle.trim() || e.meta.trim();
    const space = index === 0 ? 0 : layout.entryGap;
    const gap: GapKind | undefined = index === 0 ? undefined : "entry";

    if (!hasTop && !hasSub) {
        return bullets.map((b, i) => ({ ...bullet(`${e.id}-${i}`, b, sectionId, i === 0 ? space : 0), gap: i === 0 ? gap : undefined }));
    }
    const head: Block = {
        key: e.id,
        space,
        gap,
        sectionId,
        keepWithNext: bullets.length > 0,
        node: (
            <div>
                {hasTop && (
                    <div className="rz-row">
                        <span className="rz-title">{e.title}</span>
                        <span className="rz-date">{e.date}</span>
                    </div>
                )}
                {hasSub && (
                    <div className="rz-row rz-sub">
                        <span>{e.subtitle}</span>
                        <span className="rz-meta">{e.meta}</span>
                    </div>
                )}
            </div>
        ),
    };
    return [head, ...bullets.map((b, i) => bullet(`${e.id}-${i}`, b, sectionId))];
};

const contentBlocks = (s: ResumeSection, layout: ResumeLayout): Block[] => {
    switch (s.kind) {
        case "text":
            return nonEmpty(s.text.split("\n")).map((p, i) => ({
                key: `${s.id}-${i}`,
                space: i === 0 ? 0 : 2,
                sectionId: s.id,
                node: <p>{p}</p>,
            }));
        case "list":
            return nonEmpty(s.items).map((item, i) => bullet(`${s.id}-${i}`, item, s.id));
        case "skills":
            return s.groups
                .filter((g) => nonEmpty(g.items).length)
                .map((g) => ({
                    key: g.id,
                    space: 0,
                    sectionId: s.id,
                    node: (
                        <p>
                            {g.label.trim() && <b>{g.label}: </b>}
                            {nonEmpty(g.items).join(", ")}
                        </p>
                    ),
                }));
        case "entries":
            return s.entries.flatMap((e, i) => entryBlocks(e, i, s.id, layout));
    }
};

const contactLine = (resume: Resume) => {
    const { phone, email, location, links } = resume.header;
    const parts: ReactNode[] = [];
    if (phone.trim()) parts.push(<span key="phone">{phone}</span>);
    if (email.trim()) parts.push(<a key="email" href={`mailto:${email.trim()}`}>{email}</a>);
    if (location.trim()) parts.push(<span key="location">{location}</span>);
    links.filter((l) => l.url.trim()).forEach((l, i) => {
        parts.push(<a key={`link-${i}`} href={hrefFor(l.url.trim())}>{displayUrl(l.url.trim())}</a>);
    });
    return parts.length ? <div className="rz-contact">{parts}</div> : null;
};

export const buildBlocks = (resume: Resume): Block[] => {
    const blocks: Block[] = [
        {
            key: "header",
            space: 0,
            node: (
                <header>
                    <div className="rz-name">{resume.header.name.trim() || "Your Name"}</div>
                    {contactLine(resume)}
                </header>
            ),
        },
    ];

    for (const s of resume.sections) {
        if (s.hidden) continue;
        const content = contentBlocks(s, resume.layout);
        if (!content.length) continue; // an empty section does not print
        blocks.push({
            key: `heading-${s.id}`,
            space: resume.layout.sectionGap,
            gap: "section",
            sectionId: s.id,
            keepWithNext: true,
            node: <h2 className="rz-heading">{s.heading}</h2>,
        });
        blocks.push(...content);
    }
    return blocks;
};

/** Styles of the resume itself, shared by the preview and the printout. */
export const RESUME_CSS = `
.rz-doc { font-family: "Latin Modern Roman", "CMU Serif", "Times New Roman", Times, serif; color: #111;
  font-size: var(--rz-fs); line-height: var(--rz-lh); }
.rz-doc p { margin: 0; }
.rz-doc a { color: inherit; text-decoration: none; }
.rz-name { font-size: calc(var(--rz-fs) * 1.9); font-weight: 700; text-align: center; line-height: 1.2; }
.rz-contact { display: flex; flex-wrap: wrap; justify-content: center; column-gap: 0.45em; margin-top: 2pt; font-size: calc(var(--rz-fs) * 0.95); }
.rz-contact > * + *::before { content: "|"; margin-right: 0.45em; color: #555; }
.rz-heading { font-size: calc(var(--rz-fs) * 1.15); font-weight: 700; line-height: 1.2; margin: 0 0 3pt;
  padding-bottom: 1pt; border-bottom: 0.6pt solid #111; }
.rz-row { display: flex; justify-content: space-between; align-items: baseline; column-gap: 1em; }
.rz-title { font-weight: 700; }
.rz-sub { font-style: italic; }
.rz-date { flex-shrink: 0; white-space: nowrap; }
.rz-meta { text-align: right; max-width: 55%; }
.rz-bullet { position: relative; padding-left: 1.2em; }
.rz-bullet::before { content: "•"; position: absolute; left: 0.35em; }
`;
