import type { EmotionPrediction, EmotionResult, EmotionSummary } from "@/types";

const averagePrediction = (items: EmotionPrediction[]) => {
    if (!items.length) return undefined;
    const totals: Record<string, number> = {};
    for (const item of items) {
        for (const [name, value] of Object.entries(item.predictions)) {
            totals[name] = (totals[name] || 0) + value;
        }
    }
    const [emotion, total] = Object.entries(totals).sort((a, b) => b[1] - a[1])[0];
    return { emotion, confidence: total / items.length };
};

const present = <T,>(value: T | undefined): value is T => value !== undefined;

/** Averages the per-answer results. Returns undefined when nothing was recorded. */
export const summarizeEmotions = (results: EmotionResult[]): EmotionSummary | undefined => {
    if (!results.length) return undefined;

    const styles = results.map((r) => r.speaking_style).filter(present);
    const score = styles.length ? styles.reduce((sum, s) => sum + s.score, 0) / styles.length : undefined;

    return {
        answers: results.length,
        // Same threshold as each answer's reading (lib/voice/speaking.ts).
        speaking_style: score === undefined ? undefined : { label: score >= 0.5 ? "confident" : "anxious", score },
        emotions_3: averagePrediction(results.map((r) => r.emotions_3).filter(present)),
        emotions_6: averagePrediction(results.map((r) => r.emotions_6).filter(present)),
    };
};
