import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode, TextareaHTMLAttributes } from "react";
import { Reorder, useDragControls } from "framer-motion";
import { ArrowDown, ArrowUp, ChevronRight, Eye, EyeOff, GripVertical, Plus, Trash2, X } from "lucide-react";
import type {
    EntriesSection,
    Resume,
    ResumeEntry,
    ResumeHeader,
    ResumeSection,
    SkillsSection,
} from "@/types";
import {
    ENTRY_LABELS,
    KIND_LABELS,
    PRESET_LABELS,
    SECTION_TEMPLATES,
    newEntry,
    newGroup,
    sectionCount,
} from "@/lib/resume/model";

interface Props {
    resume: Resume;
    onChange: (updated: Resume) => void;
    /** A section clicked in the preview. The nonce repeats a click on the same one. */
    focus: { id: string; nonce: number } | null;
}

const inputClass =
    "w-full border border-gray-200 rounded-lg px-3 py-1.5 bg-white text-sm outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-300";
const smallButton =
    "inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-md text-gray-600 hover:bg-gray-100 hover:text-gray-900 disabled:opacity-30 disabled:hover:bg-transparent";
const iconButton =
    "p-1.5 rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-800 disabled:opacity-30 disabled:hover:bg-transparent";

const move = <T,>(list: T[], from: number, to: number) => {
    if (to < 0 || to >= list.length) return list;
    const next = [...list];
    next.splice(to, 0, next.splice(from, 1)[0]);
    return next;
};
const replaceAt = <T,>(list: T[], index: number, value: T) => list.map((v, i) => (i === index ? value : v));
const removeAt = <T,>(list: T[], index: number) => list.filter((_, i) => i !== index);

const Field = ({ label, value, onChange, placeholder }: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
}) => {
    const id = useId();
    return (
        <div className="space-y-1">
            <label htmlFor={id} className="block text-xs text-gray-500">{label}</label>
            <input id={id} className={inputClass} value={value} placeholder={placeholder ?? label} onChange={(e) => onChange(e.target.value)} />
        </div>
    );
};

/** A textarea that grows with its text. */
const AutoTextarea = ({ value, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string }) => {
    const ref = useRef<HTMLTextAreaElement>(null);
    useLayoutEffect(() => {
        const el = ref.current;
        if (!el) return;
        el.style.height = "auto";
        el.style.height = `${el.scrollHeight + 2}px`;
    }, [value]);
    return <textarea ref={ref} rows={1} value={value} {...props} className={`${inputClass} resize-none overflow-hidden leading-snug ${props.className ?? ""}`} />;
};

/** Keeps what was typed, so a comma does not vanish before the next word. */
const CommaListInput = ({ value, onChange, label }: { value: string[]; onChange: (list: string[]) => void; label: string }) => {
    const [text, setText] = useState(value.join(", "));
    return (
        <input
            aria-label={label}
            className={inputClass}
            placeholder="Comma-separated, e.g. Python, SQL, Docker"
            value={text}
            onChange={(e) => {
                setText(e.target.value);
                onChange(e.target.value.split(",").map((s) => s.trim()).filter(Boolean));
            }}
        />
    );
};

/** One bullet per line. Enter adds a bullet below; Backspace in an empty one removes it. */
const BulletsEditor = ({ items, onChange, placeholder, addLabel }: {
    items: string[];
    onChange: (items: string[]) => void;
    placeholder: string;
    addLabel: string;
}) => {
    const listRef = useRef<HTMLDivElement>(null);
    const focusAt = (index: number) =>
        requestAnimationFrame(() => listRef.current?.querySelectorAll("textarea")[index]?.focus());

    const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>, j: number) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onChange([...items.slice(0, j + 1), "", ...items.slice(j + 1)]);
            focusAt(j + 1);
        } else if (e.key === "Backspace" && !items[j] && items.length > 1) {
            e.preventDefault();
            onChange(removeAt(items, j));
            focusAt(Math.max(0, j - 1));
        }
    };

    return (
        <div ref={listRef} className="space-y-1.5">
            {items.map((item, j) => (
                <div key={j} className="flex items-start gap-1.5">
                    <span aria-hidden className="pt-1.5 text-gray-400 text-sm">•</span>
                    <AutoTextarea
                        aria-label={`${placeholder} ${j + 1}`}
                        placeholder={placeholder}
                        value={item}
                        onChange={(e) => onChange(replaceAt(items, j, e.target.value))}
                        onKeyDown={(e) => onKeyDown(e, j)}
                    />
                    <button type="button" className={iconButton} aria-label={`Delete ${placeholder.toLowerCase()} ${j + 1}`} onClick={() => onChange(removeAt(items, j))}>
                        <X size={14} />
                    </button>
                </div>
            ))}
            <button type="button" className={smallButton} onClick={() => { onChange([...items, ""]); focusAt(items.length); }}>
                <Plus size={13} /> {addLabel}
            </button>
        </div>
    );
};

const EntryCard = ({ entry, preset, index, total, onChange, onMove, onDelete }: {
    entry: ResumeEntry;
    preset: EntriesSection["preset"];
    index: number;
    total: number;
    onChange: (entry: ResumeEntry) => void;
    onMove: (to: number) => void;
    onDelete: () => void;
}) => {
    const labels = ENTRY_LABELS[preset];
    const controls = useDragControls();
    const name = entry.title || entry.subtitle || `Entry ${index + 1}`;
    return (
        <Reorder.Item value={entry} dragListener={false} dragControls={controls} className="rounded-lg border border-gray-200 bg-white p-3 space-y-2">
            <div className="flex items-center gap-1">
                <button type="button" className={`${iconButton} cursor-grab touch-none`} aria-label={`Drag to reorder ${name}`} onPointerDown={(e) => controls.start(e)}>
                    <GripVertical size={14} />
                </button>
                <span className="flex-1 truncate text-xs font-medium text-gray-500">{name}</span>
                <button type="button" className={iconButton} aria-label={`Move ${name} up`} disabled={index === 0} onClick={() => onMove(index - 1)}><ArrowUp size={14} /></button>
                <button type="button" className={iconButton} aria-label={`Move ${name} down`} disabled={index === total - 1} onClick={() => onMove(index + 1)}><ArrowDown size={14} /></button>
                <button type="button" className={`${iconButton} hover:text-red-600`} aria-label={`Delete ${name}`} onClick={onDelete}><Trash2 size={14} /></button>
            </div>
            <div className="grid grid-cols-2 gap-2">
                {(["title", "date", "subtitle", "meta"] as const).map((field) => (
                    <Field key={field} label={labels[field]} value={entry[field]} onChange={(v) => onChange({ ...entry, [field]: v })} />
                ))}
            </div>
            <BulletsEditor items={entry.bullets} placeholder="Bullet point" addLabel="Add bullet" onChange={(bullets) => onChange({ ...entry, bullets })} />
        </Reorder.Item>
    );
};

const EntriesEditor = ({ section, onChange }: { section: EntriesSection; onChange: (s: EntriesSection) => void }) => {
    const set = (entries: ResumeEntry[]) => onChange({ ...section, entries });
    return (
        <div className="space-y-2">
            <Reorder.Group axis="y" values={section.entries} onReorder={set} className="space-y-2">
                {section.entries.map((entry, i) => (
                    <EntryCard
                        key={entry.id}
                        entry={entry}
                        preset={section.preset}
                        index={i}
                        total={section.entries.length}
                        onChange={(e) => set(replaceAt(section.entries, i, e))}
                        onMove={(to) => set(move(section.entries, i, to))}
                        onDelete={() => set(removeAt(section.entries, i))}
                    />
                ))}
            </Reorder.Group>
            <button type="button" className={smallButton} onClick={() => set([...section.entries, newEntry()])}>
                <Plus size={13} /> Add {PRESET_LABELS[section.preset] === "Entries" ? "entry" : `${PRESET_LABELS[section.preset].toLowerCase()} entry`}
            </button>
        </div>
    );
};

const SkillsEditor = ({ section, onChange }: { section: SkillsSection; onChange: (s: SkillsSection) => void }) => {
    const set = (groups: SkillsSection["groups"]) => onChange({ ...section, groups });
    return (
        <div className="space-y-2">
            {section.groups.map((g, i) => (
                <div key={g.id} className="grid grid-cols-[9rem_1fr_auto] gap-1.5 items-start">
                    <input aria-label={`Group ${i + 1} name`} className={inputClass} placeholder="Group, e.g. Languages" value={g.label} onChange={(e) => set(replaceAt(section.groups, i, { ...g, label: e.target.value }))} />
                    <CommaListInput key={g.id} label={`${g.label || `Group ${i + 1}`} skills`} value={g.items} onChange={(items) => set(replaceAt(section.groups, i, { ...g, items }))} />
                    <button type="button" className={iconButton} aria-label={`Delete group ${g.label || i + 1}`} onClick={() => set(removeAt(section.groups, i))}><X size={14} /></button>
                </div>
            ))}
            <button type="button" className={smallButton} onClick={() => set([...section.groups, newGroup()])}><Plus size={13} /> Add group</button>
        </div>
    );
};

const SectionBody = ({ section, onChange }: { section: ResumeSection; onChange: (s: ResumeSection) => void }) => {
    switch (section.kind) {
        case "text":
            return <AutoTextarea aria-label={`${section.heading} text`} placeholder="A few sentences" value={section.text} onChange={(e) => onChange({ ...section, text: e.target.value })} />;
        case "list":
            return <BulletsEditor items={section.items} placeholder="Item" addLabel="Add item" onChange={(items) => onChange({ ...section, items })} />;
        case "skills":
            return <SkillsEditor section={section} onChange={onChange} />;
        case "entries":
            return <EntriesEditor section={section} onChange={onChange} />;
    }
};

const SectionCard = ({ section, index, total, open, onToggle, onChange, onMove, onDelete }: {
    section: ResumeSection;
    index: number;
    total: number;
    open: boolean;
    onToggle: () => void;
    onChange: (s: ResumeSection) => void;
    onMove: (to: number) => void;
    onDelete: () => void;
}) => {
    const controls = useDragControls();
    const [confirmDelete, setConfirmDelete] = useState(false);
    const bodyId = useId();
    const name = section.heading || "Untitled section";
    const kind = section.kind === "entries" ? PRESET_LABELS[section.preset] : KIND_LABELS[section.kind];

    return (
        <Reorder.Item
            id={`section-${section.id}`}
            value={section}
            dragListener={false}
            dragControls={controls}
            className={`rounded-xl border bg-[#fcfcfc] ${open ? "border-gray-300" : "border-gray-200"} ${section.hidden ? "opacity-60" : ""}`}
        >
            <div className="flex items-center gap-1 px-2 py-1.5">
                <button type="button" className={`${iconButton} cursor-grab touch-none`} aria-label={`Drag to reorder ${name}`} onPointerDown={(e) => controls.start(e)}>
                    <GripVertical size={15} />
                </button>
                <button type="button" className="flex flex-1 min-w-0 items-center gap-1.5 py-1 text-left" aria-expanded={open} aria-controls={bodyId} onClick={onToggle}>
                    <ChevronRight size={15} className={`shrink-0 text-gray-400 transition-transform ${open ? "rotate-90" : ""}`} />
                    <span className="truncate text-sm font-semibold text-gray-800">{name}</span>
                    <span className="shrink-0 text-xs text-gray-400">{kind} · {sectionCount(section)}{section.hidden ? " · hidden" : ""}</span>
                </button>
                <button type="button" className={iconButton} aria-label={`Move ${name} up`} disabled={index === 0} onClick={() => onMove(index - 1)}><ArrowUp size={15} /></button>
                <button type="button" className={iconButton} aria-label={`Move ${name} down`} disabled={index === total - 1} onClick={() => onMove(index + 1)}><ArrowDown size={15} /></button>
                <button
                    type="button"
                    className={iconButton}
                    aria-label={section.hidden ? `Show ${name} in the resume` : `Hide ${name} from the resume`}
                    aria-pressed={!!section.hidden}
                    onClick={() => onChange({ ...section, hidden: !section.hidden })}
                >
                    {section.hidden ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
                {confirmDelete ? (
                    <span className="flex items-center gap-1 text-xs">
                        <button type="button" className="rounded-md bg-red-600 px-2 py-1 font-medium text-white" onClick={onDelete}>Delete</button>
                        <button type="button" className="rounded-md px-2 py-1 text-gray-600 hover:bg-gray-100" onClick={() => setConfirmDelete(false)}>Keep</button>
                    </span>
                ) : (
                    <button type="button" className={`${iconButton} hover:text-red-600`} aria-label={`Delete ${name}`} onClick={() => setConfirmDelete(true)}><Trash2 size={15} /></button>
                )}
            </div>
            {open && (
                <div id={bodyId} className="space-y-3 border-t border-gray-200 px-3 pb-3 pt-3">
                    <Field label="Heading on the resume" value={section.heading} onChange={(heading) => onChange({ ...section, heading })} />
                    <SectionBody section={section} onChange={onChange} />
                </div>
            )}
        </Reorder.Item>
    );
};

const HeaderCard = ({ resume, onChange }: { resume: Resume; onChange: (r: Resume) => void }) => {
    const [open, setOpen] = useState(true);
    const h = resume.header;
    const setHeader = (header: ResumeHeader) => onChange({ ...resume, header });
    const bodyId = useId();
    return (
        <div className={`rounded-xl border bg-[#fcfcfc] ${open ? "border-gray-300" : "border-gray-200"}`}>
            <button type="button" className="flex w-full items-center gap-1.5 px-3 py-2.5 text-left" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen(!open)}>
                <ChevronRight size={15} className={`text-gray-400 transition-transform ${open ? "rotate-90" : ""}`} />
                <span className="text-sm font-semibold text-gray-800">Name and contact</span>
                <span className="truncate text-xs text-gray-400">{h.name || "Not filled in"}</span>
            </button>
            {open && (
                <div id={bodyId} className="space-y-3 border-t border-gray-200 p-3">
                    <div className="grid grid-cols-2 gap-2">
                        <Field label="Full name" value={h.name} onChange={(name) => setHeader({ ...h, name })} />
                        <Field label="Email" value={h.email} onChange={(email) => setHeader({ ...h, email })} />
                        <Field label="Phone" value={h.phone} onChange={(phone) => setHeader({ ...h, phone })} />
                        <Field label="Location" value={h.location} placeholder="City, Country" onChange={(location) => setHeader({ ...h, location })} />
                    </div>
                    <div className="space-y-1.5">
                        <p className="text-xs text-gray-500">Links</p>
                        {h.links.map((link, i) => (
                            <div key={i} className="grid grid-cols-[8rem_1fr_auto] gap-1.5">
                                <input aria-label={`Link ${i + 1} label`} className={inputClass} placeholder="Label" value={link.label} onChange={(e) => setHeader({ ...h, links: replaceAt(h.links, i, { ...link, label: e.target.value }) })} />
                                <input aria-label={`Link ${i + 1} address`} className={inputClass} placeholder="github.com/you" value={link.url} onChange={(e) => setHeader({ ...h, links: replaceAt(h.links, i, { ...link, url: e.target.value }) })} />
                                <button type="button" className={iconButton} aria-label={`Delete link ${link.label || i + 1}`} onClick={() => setHeader({ ...h, links: removeAt(h.links, i) })}><X size={14} /></button>
                            </div>
                        ))}
                        <button
                            type="button"
                            className={smallButton}
                            onClick={() => {
                                const has = (name: string) => h.links.some((l) => l.label.toLowerCase() === name.toLowerCase());
                                const label = ["LinkedIn", "GitHub", "Portfolio"].find((n) => !has(n)) ?? "";
                                setHeader({ ...h, links: [...h.links, { label, url: "" }] });
                            }}
                        >
                            <Plus size={13} /> Add link
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

const AddSectionMenu = ({ onAdd }: { onAdd: (s: ResumeSection) => void }) => {
    const [open, setOpen] = useState(false);
    return (
        <div className="relative">
            <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="w-full rounded-xl border border-dashed border-gray-300 py-2 text-sm font-medium text-gray-600 hover:border-gray-500 hover:text-gray-900">
                <Plus size={15} className="mr-1 inline" /> Add section
            </button>
            {open && (
                <div className="mt-1.5 grid grid-cols-2 gap-1 rounded-xl border border-gray-200 bg-white p-1.5 shadow-sm">
                    {SECTION_TEMPLATES.map((t) => (
                        <button key={t.label} type="button" className="rounded-lg px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-100" onClick={() => { onAdd(t.make()); setOpen(false); }}>
                            {t.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};

const Hint = ({ children }: { children: ReactNode }) => <p className="px-1 text-xs leading-relaxed text-gray-500">{children}</p>;

export default function ResumeEditor({ resume, onChange, focus }: Props) {
    const [openIds, setOpenIds] = useState<Set<string>>(new Set());
    const sections = resume.sections;
    const setSections = (next: ResumeSection[]) => onChange({ ...resume, sections: next });
    const toggle = (id: string) =>
        setOpenIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });

    // Open and show the section clicked in the preview.
    useEffect(() => {
        if (!focus) return;
        setOpenIds((prev) => new Set(prev).add(focus.id));
        requestAnimationFrame(() =>
            document.getElementById(`section-${focus.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" })
        );
    }, [focus]);

    return (
        <div className="h-full overflow-y-auto bg-[#fafafa] p-3 space-y-2">
            <HeaderCard resume={resume} onChange={onChange} />
            <Reorder.Group axis="y" values={sections} onReorder={setSections} className="space-y-2">
                {sections.map((s, i) => (
                    <SectionCard
                        key={s.id}
                        section={s}
                        index={i}
                        total={sections.length}
                        open={openIds.has(s.id)}
                        onToggle={() => toggle(s.id)}
                        onChange={(updated) => setSections(replaceAt(sections, i, updated))}
                        onMove={(to) => setSections(move(sections, i, to))}
                        onDelete={() => setSections(removeAt(sections, i))}
                    />
                ))}
            </Reorder.Group>
            <AddSectionMenu
                onAdd={(s) => {
                    setSections([...sections, s]);
                    setOpenIds((prev) => new Set(prev).add(s.id));
                }}
            />
            <Hint>Click a section in the preview to edit it here. Empty and hidden sections are left out of the PDF.</Hint>
        </div>
    );
}
