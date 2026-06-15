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
