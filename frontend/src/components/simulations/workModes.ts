export const WORK_MODES = ["All", "Remote", "Hybrid", "On-site"] as const;
export type WorkMode = (typeof WORK_MODES)[number];
