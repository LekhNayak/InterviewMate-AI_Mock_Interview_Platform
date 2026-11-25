import type { Resume } from "@/types";

const PAGE = { width: 210, height: 297, margin: 18 };
const WIDTH = PAGE.width - PAGE.margin * 2;
const BULLET = "•";

/** Saves the resume as a PDF with selectable text. */
export const exportResumeToPdf = async (resume: Resume) => {
    // Loaded on demand, the library is large.
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    let y = PAGE.margin;

    const ensureSpace = (needed: number) => {
        if (y + needed > PAGE.height - PAGE.margin) {
            doc.addPage();
            y = PAGE.margin;
        }
    };

    const lineHeight = (size: number) => size * 0.3528 * 1.3;

    const text = (value: string, opts: { size?: number; style?: "normal" | "bold" | "italic"; indent?: number; align?: "left" | "center" } = {}) => {
        const { size = 10, style = "normal", indent = 0, align = "left" } = opts;
        doc.setFont("times", style);
        doc.setFontSize(size);
        for (const line of doc.splitTextToSize(value, WIDTH - indent) as string[]) {
            ensureSpace(lineHeight(size));
            y += lineHeight(size);
            if (align === "center") doc.text(line, PAGE.width / 2, y, { align: "center" });
            else doc.text(line, PAGE.margin + indent, y);
        }
    };

    // Text on the left and a date on the right of the same line.
    const row = (left: string, right: string) => {
        text(left, { style: "bold" });
        if (!right) return;
        doc.setFont("times", "italic");
        doc.setFontSize(9);
        doc.text(right, PAGE.width - PAGE.margin, y, { align: "right" });
    };

    const bullet = (value: string) => {
        ensureSpace(lineHeight(10));
        doc.setFont("times", "normal");
        doc.setFontSize(10);
        doc.text(BULLET, PAGE.margin + 1.5, y + lineHeight(10));
        text(value, { indent: 5 });
    };

    const section = (title: string) => {
        ensureSpace(14);
        y += 4;
        text(title, { size: 12, style: "bold" });
        y += 1.2;
        doc.setLineWidth(0.3);
        doc.line(PAGE.margin, y, PAGE.width - PAGE.margin, y);
        y += 0.8;
    };

    const { header, skills } = resume;
    text(header?.name || "Your Name", { size: 20, style: "bold", align: "center" });
    const contact = [header?.phone, header?.email, header?.github].filter(Boolean).join("  |  ");
    if (contact) text(contact, { size: 9.5, align: "center" });

    if (resume.objective) {
        section("Objective");
        text(resume.objective);
    }

    if (resume.education?.length) {
        section("Education");
        for (const edu of resume.education) {
            row(edu.institution, edu.duration);
            const detail = [edu.degree, edu.score].filter(Boolean).join(", ");
            if (detail) text(detail);
            y += 1;
        }
    }

    const skillLines = [
        ["Languages", skills?.languages],
        ["Frameworks & Tools", skills?.frameworks],
        ["Other", skills?.other],
    ] as const;
    if (skillLines.some(([, list]) => list?.length)) {
        section("Technical Skills");
        for (const [label, list] of skillLines) {
            if (list?.length) text(`${label}: ${list.join(", ")}`);
        }
    }

    if (resume.projects?.length) {
        section("Projects");
        for (const proj of resume.projects) {
            row(proj.title, proj.duration);
            const detail = [proj.tech, proj.event].filter(Boolean).join(" | ");
            if (detail) text(detail, { style: "italic" });
            (proj.points || []).filter((p) => p.trim()).forEach(bullet);
            y += 1;
        }
    }

    if (resume.activities?.length) {
        section("Extracurricular Activities");
        resume.activities.filter((a) => a.trim()).forEach(bullet);
    }

    const fileName = (header?.name || resume.title || "resume").replace(/[\\/:*?"<>|]+/g, "").trim() || "resume";
    doc.save(`${fileName}.pdf`);
};
