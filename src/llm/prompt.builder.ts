import { Profile, Job } from '@prisma/client';

// --- Generation context helpers (T1.1 + T1.2) -------------------------------
// These ground proposal generation in the saved Job-Intelligence analysis and
// the studio's real proof points, instead of only title + services.

type Analysis = {
  objective?: string;
  complexity?: string;
  estimatedWeeks?: number;
  estimatedBudgetUsd?: number;
  stack?: unknown;
  deliverables?: unknown;
  risks?: unknown;
};
type CaseStudy = { title?: string; summary?: string };
type Testimonial = { author?: string; company?: string; quote?: string };

const asArray = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

// Compact grounding context from the saved analysis (Job.intelligenceJson), if present.
export function analysisContext(job: Job): string {
  const a = job.intelligenceJson as unknown as Analysis | null;
  if (!a || typeof a !== 'object') return '';
  const riskTitles = asArray<{ title?: string }>(a.risks).map((r) => r.title).filter(Boolean).slice(0, 5);
  const parts = [
    a.objective ? `Client objective: ${a.objective}` : '',
    a.complexity ? `Complexity: ${a.complexity}` : '',
    a.estimatedWeeks ? `Estimated effort: ~${a.estimatedWeeks} weeks` : '',
    a.estimatedBudgetUsd ? `Estimated budget (USD): ${a.estimatedBudgetUsd}` : '',
    asArray<string>(a.stack).length ? `Likely stack: ${asArray<string>(a.stack).slice(0, 10).join(', ')}` : '',
    asArray<string>(a.deliverables).length ? `Key deliverables: ${asArray<string>(a.deliverables).slice(0, 8).join('; ')}` : '',
    riskTitles.length ? `Risks to address: ${riskTitles.join('; ')}` : '',
  ].filter(Boolean);
  return parts.length ? `Pre-analysis of this opportunity (ground the proposal in it):\n${parts.join('\n')}` : '';
}

// Studio proof points so the proposal can reference REAL portfolio/case studies (never invent).
export function proofContext(profile: Profile): string {
  const cases = asArray<CaseStudy>(profile.caseStudies)
    .slice(0, 3)
    .map((c) => (c.title ? `${c.title}${c.summary ? ` — ${c.summary}` : ''}` : ''))
    .filter(Boolean);
  const tests = asArray<Testimonial>(profile.testimonials)
    .slice(0, 2)
    .map((t) => (t.quote ? `"${t.quote}"${t.author ? ` — ${t.author}${t.company ? `, ${t.company}` : ''}` : ''}` : ''))
    .filter(Boolean);
  const links = (profile.portfolioLinks ?? []).slice(0, 5);
  const parts = [
    profile.website ? `Website: ${profile.website}` : '',
    links.length ? `Portfolio: ${links.join(', ')}` : '',
    cases.length ? `Relevant case studies: ${cases.join(' | ')}` : '',
    tests.length ? `Testimonials: ${tests.join(' | ')}` : '',
  ].filter(Boolean);
  return parts.length ? `Use these real proof points where relevant (never invent others):\n${parts.join('\n')}` : '';
}

export function buildProposalPrompt(profile: Profile & { profession?: string }, job: Job) {
  const system = [
    `You are a senior proposal writer for ${profile.agencyName}, a ${profile.profession ?? 'professional'} studio.`,
    `Write in a ${profile.tone} tone. Be specific, confident, and client-focused.`,
    `Keep pricing within $${profile.priceMin}-$${profile.priceMax} unless the brief clearly demands otherwise.`,
  ].join(' ');
  const user = [
    `Write a complete client proposal for the job "${job.title}" (client: ${job.company}).`,
    job.projectDescription ? `Project: ${job.projectDescription}` : '',
    job.requirements ? `Requirements: ${job.requirements}` : '',
    job.budget ? `Stated budget (USD): ${job.budget}` : '',
    job.timeline ? `Stated timeline: ${job.timeline}` : '',
    `Our services: ${profile.services.join(', ')}. Our skills: ${profile.skills.join(', ')}.`,
    analysisContext(job),
    proofContext(profile),
    `Return JSON with keys: summary (string), scope (string[]), timelineWeeks (number), priceUsd (number), closing (string).`,
  ].filter(Boolean).join('\n');
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
    analysisContext(job),
    proofContext(profile),
    `For context, the current proposal is: ${JSON.stringify(current)}.`,
    `Return JSON with a single key "value" whose value is ${spec.type}. Return nothing else.`,
  ].filter(Boolean).join('\n');
  return { system, user };
}
