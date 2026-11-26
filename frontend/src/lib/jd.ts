import type { JobDescription } from "@/types";

type JobFields = Pick<JobDescription, "title" | "company" | "location" | "jobType" | "requiredSkills" | "description">;

/** A job as plain text for the interviewer. Same layout as the API's jdToText (backend/src/utils/jdText.js). */
export const jdToText = (job: JobFields) =>
    `
Job Title: ${job.title}
Company: ${job.company}
Location: ${job.location}
Job Type: ${job.jobType}
Required Skills: ${(job.requiredSkills || []).join(", ")}

Description:
${job.description || "No description provided."}
`.trim();
