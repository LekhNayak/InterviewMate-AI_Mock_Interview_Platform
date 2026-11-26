import type { Resume, ResumeEntry, ResumeSection } from "@/types";
import { displayUrl, hrefFor } from "./model";

// LaTeX for a resume, with the same sections, order and spacing as the preview.
// It compiles with pdfLaTeX and only standard packages, so Overleaf builds it as is.

const SPECIAL: Record<string, string> = {
    "\\": "\\textbackslash{}",
    "{": "\\{",
    "}": "\\}",
    $: "\\$",
    "&": "\\&",
    "%": "\\%",
    "#": "\\#",
    _: "\\_",
    "~": "\\textasciitilde{}",
    "^": "\\textasciicircum{}",
    "<": "\\textless{}",
    ">": "\\textgreater{}",
    "|": "\\textbar{}",
    "•": "\\textbullet{}",
    "→": "$\\rightarrow$",
    "←": "$\\leftarrow$",
    "≥": "$\\geq$",
    "≤": "$\\leq$",
};

/** Text as LaTeX. Emoji are dropped: pdfLaTeX cannot print them. */
export const escapeLatex = (value: string) =>
    (value || "")
        .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
        .replace(/\u{FE0F}/gu, "")
        .replace(/[\\{}$&%#_~^<>|•→←≥≤]/g, (ch) => SPECIAL[ch]);

/** A URL inside \href, where only these characters need care. */
const escapeUrl = (url: string) => url.replace(/[\\{}]/g, "").replace(/([%#&])/g, "\\$1");

const pt = (n: number) => `${Number(n.toFixed(2))}pt`;
const nonEmpty = (list: string[]) => list.map((s) => s.trim()).filter(Boolean);

const itemize = (items: string[]) =>
    items.length ? `\\begin{itemize}\n${items.map((i) => `  \\item ${escapeLatex(i)}`).join("\n")}\n\\end{itemize}` : "";

const entry = (e: ResumeEntry) => {
    const lines: string[] = [];
    if (e.title.trim() || e.date.trim()) {
        lines.push(`\\textbf{${escapeLatex(e.title)}}${e.date.trim() ? `\\hfill ${escapeLatex(e.date)}` : ""}`);
    }
    if (e.subtitle.trim() || e.meta.trim()) {
        lines.push(`\\textit{${escapeLatex(e.subtitle)}}${e.meta.trim() ? `\\hfill \\textit{${escapeLatex(e.meta)}}` : ""}`);
    }
    const head = lines.length ? `${lines.join("\\\\\n")}\\par` : "";
    return [head, itemize(nonEmpty(e.bullets))].filter(Boolean).join("\n");
};

const body = (s: ResumeSection, entryGap: number): string => {
    switch (s.kind) {
        case "text":
            return nonEmpty(s.text.split("\n")).map((p) => `${escapeLatex(p)}\\par`).join("\n");
        case "list":
            return itemize(nonEmpty(s.items));
        case "skills": {
            const lines = s.groups
                .filter((g) => nonEmpty(g.items).length)
                .map((g) => `${g.label.trim() ? `\\textbf{${escapeLatex(g.label)}}: ` : ""}${escapeLatex(nonEmpty(g.items).join(", "))}`);
            return lines.length ? `${lines.join("\\\\\n")}\\par` : "";
        }
        case "entries":
            return s.entries.map(entry).filter(Boolean).join(`\n\\vspace{${pt(entryGap)}}\n`);
    }
};

export const generateLatex = (resume: Resume) => {
    const { header, layout } = resume;
    const baseline = layout.fontSize * layout.lineHeight;
    const nameSize = layout.fontSize * 1.9;
    const headingSize = layout.fontSize * 1.15;

    const contact = [
        header.phone && escapeLatex(header.phone),
        header.email && `\\href{${escapeUrl(`mailto:${header.email.trim()}`)}}{${escapeLatex(header.email)}}`,
        header.location && escapeLatex(header.location),
        ...header.links.filter((l) => l.url.trim()).map((l) => `\\href{${escapeUrl(hrefFor(l.url.trim()))}}{${escapeLatex(displayUrl(l.url))}}`),
    ].filter(Boolean);

    const sections = resume.sections
        .filter((s) => !s.hidden)
        .map((s) => ({ s, content: body(s, layout.entryGap) }))
        .filter(({ content }) => content.trim())
        .map(({ s, content }) => `\\section*{${escapeLatex(s.heading)}}\n${content}`)
        .join("\n\n");

    return `% Made with InterviewMate. Compile with pdfLaTeX, for example on Overleaf.
\\documentclass[a4paper]{article}
\\usepackage[T1]{fontenc}
\\usepackage[utf8]{inputenc}
\\usepackage{lmodern}
\\usepackage[a4paper,margin=${layout.margin}mm]{geometry}
\\usepackage{enumitem}
\\usepackage{titlesec}
\\usepackage[hidelinks]{hyperref}

\\pagestyle{empty}
\\setlength{\\parindent}{0pt}
\\setlength{\\parskip}{0pt}
\\titleformat{\\section}{\\fontsize{${pt(headingSize)}}{${pt(headingSize * 1.2)}}\\selectfont\\bfseries}{}{0pt}{}[\\vspace{1pt}\\titlerule]
\\titlespacing*{\\section}{0pt}{${pt(layout.sectionGap)}}{${pt(4)}}
\\setlist[itemize]{leftmargin=1.2em, label=\\textbullet, itemsep=0pt, parsep=0pt, topsep=1pt, partopsep=0pt}

\\begin{document}
\\fontsize{${pt(layout.fontSize)}}{${pt(baseline)}}\\selectfont

\\begin{center}
{\\fontsize{${pt(nameSize)}}{${pt(nameSize * 1.2)}}\\selectfont\\bfseries ${escapeLatex(header.name || "Your Name")}}${contact.length ? `\\\\[3pt]\n${contact.join(" \\textbar{} ")}` : ""}
\\end{center}

${sections}

\\end{document}
`;
};

/** Opens the LaTeX as a new Overleaf project, which compiles it. */
export const openInOverleaf = (latex: string, name: string) => {
    const form = document.createElement("form");
    form.method = "POST";
    form.action = "https://www.overleaf.com/docs";
    form.target = "_blank";
    for (const [key, value] of Object.entries({ snip: latex, snip_name: name, engine: "pdflatex" })) {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = key;
        input.value = value;
        form.appendChild(input);
    }
    document.body.appendChild(form);
    form.submit();
    form.remove();
};

export const downloadLatex = (latex: string, name: string) => {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([latex], { type: "application/x-tex" }));
    link.download = `${name}.tex`;
    link.click();
    URL.revokeObjectURL(link.href);
};
