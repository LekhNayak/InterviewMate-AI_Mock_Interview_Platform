// `job.uploadedBy` may be an id, a populated user, or null if the uploader was deleted.
const ownerId = (job) => String(job.uploadedBy?._id || job.uploadedBy || '');

const canReadJd = (job, user) => job.isPublic || ownerId(job) === String(user._id);

const jdToText = (job) => `
Job Title: ${job.title}
Company: ${job.company}
Location: ${job.location}
Job Type: ${job.jobType}
Required Skills: ${(job.requiredSkills || []).join(', ')}

Description:
${job.description || 'No description provided.'}
`.trim();

module.exports = { ownerId, canReadJd, jdToText };
