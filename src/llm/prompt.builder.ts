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
