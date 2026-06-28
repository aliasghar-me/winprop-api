import { Profile, Job } from '@prisma/client';

export function buildProposalPrompt(profile: Profile & { profession?: string }, job: Job) {
  const system = [
    `You are a senior proposal writer for ${profile.agencyName}, a ${profile.profession ?? 'professional'} studio.`,
    `Write in a ${profile.tone} tone. Be specific, confident, and client-focused.`,
    `Keep pricing within $${profile.priceMin}-$${profile.priceMax} unless the brief clearly demands otherwise.`,
  ].join(' ');
  const user = [
    `Write a complete client proposal for the job "${job.title}" (client: ${job.company}).`,
    `Our services: ${profile.services.join(', ')}. Our skills: ${profile.skills.join(', ')}.`,
    `Return JSON with keys: summary (string), scope (string[]), timelineWeeks (number), priceUsd (number), closing (string).`,
  ].join('\n');
  return { system, user };
}

// Job-Intelligence (Phase-1) analysis prompt. Strictly grounded in the job text +
// studio profile — must not invent client history or facts not present.
export function buildJobIntelligencePrompt(profile: Profile & { profession?: string }, job: Job) {
  const system = [
    `You are a senior proposal strategist and solutions architect analyzing an opportunity for ${profile.agencyName}, a ${profile.profession ?? 'professional'} studio.`,
    `Analyze ONLY from the job text and the studio profile below. Do not fabricate client history, names, or facts not present. Be realistic and concise.`,
  ].join(' ');
  const user = [
    `Analyze this opportunity.`,
    `Title: ${job.title}`,
    job.company && job.company !== '—' ? `Company: ${job.company}` : '',
    job.projectDescription ? `Project: ${job.projectDescription}` : '',
    job.requirements ? `Requirements: ${job.requirements}` : '',
    job.budget ? `Stated budget (USD): ${job.budget}` : '',
    job.timeline ? `Stated timeline: ${job.timeline}` : '',
    `Our services: ${profile.services.join(', ')}. Our skills: ${profile.skills.join(', ')}. Our price range: $${profile.priceMin}-$${profile.priceMax}.`,
    `Return JSON with keys: objective (string), domain (string), seniority (string), complexity ("Low"|"Medium"|"High"), estimatedWeeks (number), estimatedBudgetUsd (number), stack (string[]), deliverables (string[]), integrations (string[]), risks (array of {title (string), severity ("low"|"medium"|"high"), note (string)}), clarificationQuestions (array of up to 6 high-value question strings), winProbability (object {score (number 0-100), reasons (string[]), improvements (string[])}).`,
    `Base winProbability on the honest fit between this job and our skills/price range. Return nothing else.`,
  ].filter(Boolean).join('\n');
  return { system, user };
}

// Section name (editor) -> content key + expected JSON type. Used by the
// per-section regenerate flow so we re-bill a small call instead of the whole doc.
export const PROPOSAL_SECTIONS = {
  summary: { key: 'summary', type: 'a string' },
  scope: { key: 'scope', type: 'an array of short strings' },
  timeline: { key: 'timelineWeeks', type: 'a number of weeks' },
  pricing: { key: 'priceUsd', type: 'a number in USD' },
  closing: { key: 'closing', type: 'a string' },
} as const;

export type ProposalSection = keyof typeof PROPOSAL_SECTIONS;

export function buildSectionPrompt(
  profile: Profile & { profession?: string },
  job: Job,
  section: ProposalSection,
  current: Record<string, unknown>,
) {
  const spec = PROPOSAL_SECTIONS[section];
  const system = [
    `You are a senior proposal writer for ${profile.agencyName}, a ${profile.profession ?? 'professional'} studio.`,
    `Write in a ${profile.tone} tone. Be specific, confident, and client-focused.`,
    `Keep pricing within $${profile.priceMin}-$${profile.priceMax} unless the brief clearly demands otherwise.`,
  ].join(' ');
  const user = [
    `Regenerate ONLY the "${section}" section of this proposal for the job "${job.title}" (client: ${job.company}).`,
    job.projectDescription ? `Project: ${job.projectDescription}` : '',
    job.requirements ? `Requirements: ${job.requirements}` : '',
    `Our services: ${profile.services.join(', ')}. Our skills: ${profile.skills.join(', ')}.`,
    `For context, the current proposal is: ${JSON.stringify(current)}.`,
    `Return JSON with a single key "value" whose value is ${spec.type}. Return nothing else.`,
  ].filter(Boolean).join('\n');
  return { system, user };
}
