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

export type MemoryFact = { category: string; key: string; value: string };

// Known facts about the freelancer (from the memory store) so the AI personalizes
// and NEVER re-asks for things we already know.
export function memoryContext(memories?: MemoryFact[]): string {
  const facts = (memories ?? []).filter((m) => m && m.key && m.value).slice(0, 25);
  if (!facts.length) return '';
  const lines = facts.map((m) => `- ${m.category ? m.category + '/' : ''}${m.key}: ${m.value}`);
  return `What we already know about this freelancer (use naturally; do NOT ask for these):\n${lines.join('\n')}`;
}

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

export function buildProposalPrompt(profile: Profile & { profession?: string }, job: Job, memories: MemoryFact[] = []) {
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
    memoryContext(memories),
    `Return JSON with keys: summary (string), scope (string[]), timelineWeeks (number), priceUsd (number), closing (string).`,
  ].filter(Boolean).join('\n');
  return { system, user };
}

// Job-Intelligence (Phase-1) analysis prompt. Strictly grounded in the job text +
// studio profile — must not invent client history or facts not present.
export function buildJobIntelligencePrompt(profile: Profile & { profession?: string }, job: Job, memories: MemoryFact[] = []) {
  const system = [
    `You are a senior proposal strategist advising ${profile.agencyName}, a ${profile.profession ?? 'professional'} studio, on ONE decision: "Should we spend the next hour applying to this job?"`,
    `Analyze ONLY from the job text and the studio profile below. Do not fabricate client history, names, or facts not present. Be realistic, honest, and decisive — it is more valuable to say "avoid" on a low-fit job than to encourage a wasted application.`,
  ].join(' ');
  const user = [
    `Analyze this opportunity and give an apply/don't-apply recommendation grounded in OUR profile.`,
    `Title: ${job.title}`,
    job.company && job.company !== '—' ? `Company: ${job.company}` : '',
    job.projectDescription ? `Project: ${job.projectDescription}` : '',
    job.requirements ? `Requirements: ${job.requirements}` : '',
    job.budget ? `Stated budget (USD): ${job.budget}` : '',
    job.timeline ? `Stated timeline: ${job.timeline}` : '',
    `Our services: ${profile.services.join(', ')}. Our skills: ${profile.skills.join(', ')}. Our price range: $${profile.priceMin}-$${profile.priceMax}.`,
    memoryContext(memories),
    `Return JSON with keys: objective (string), domain (string), seniority (string), complexity ("Low"|"Medium"|"High"), estimatedWeeks (number), estimatedBudgetUsd (number), stack (string[]), deliverables (string[]), integrations (string[]), risks (array of {title (string), severity ("low"|"medium"|"high"), note (string)}), clarificationQuestions (array of up to 6 high-value question strings), winProbability (object {score (number 0-100), reasons (string[]), improvements (string[])}), recommendation ("apply"|"maybe"|"avoid"), fit (object {portfolio (number 0-100), skills (number 0-100), budget (number 0-100), competition ("Low"|"Medium"|"High")}), expectedRoiUsdPerHour (number — estimated value of applying: (win chance × project value) / hours to win and deliver), redFlags (array of short strings; include scam signals, vague scope, unrealistic budget, or "none").`,
    `Ground recommendation and fit in the honest match between this job and OUR skills/portfolio/price range. "apply" only when fit and ROI justify the hour; "avoid" for low fit, red flags, or poor ROI. Return nothing else.`,
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

// T1.3 — "Adjust tone": the four tones map to concrete writing guidance.
export const TONES = ['formal', 'aggressive', 'premium', 'casual'] as const;
export type ToneName = (typeof TONES)[number];
const TONE_GUIDANCE: Record<ToneName, string> = {
  formal: 'precise, professional, and measured; no slang.',
  aggressive: 'confident, outcome-led, and urgent; lead with results and momentum.',
  premium: 'understated, selective, and quality-forward; calm authority, no hard sell.',
  casual: 'warm, plain-spoken, and approachable; conversational but credible.',
};

// Re-run the PROSE sections (summary + closing) in a new tone, in one call.
export function buildToneAdjustPrompt(
  profile: Profile & { profession?: string },
  job: Job,
  tone: ToneName,
  current: Record<string, unknown>,
) {
  const system = [
    `You are a senior proposal writer for ${profile.agencyName}, a ${profile.profession ?? 'professional'} studio.`,
    `Rewrite in a ${tone} tone — ${TONE_GUIDANCE[tone]} Keep the meaning and facts; change only the voice.`,
  ].join(' ');
  const user = [
    `Rewrite ONLY the "summary" and "closing" of this proposal for "${job.title}" (client: ${job.company}) in the new tone.`,
    proofContext(profile),
    `Current proposal: ${JSON.stringify(current)}.`,
    `Return JSON with exactly two keys: summary (string), closing (string). Return nothing else.`,
  ].filter(Boolean).join('\n');
  return { system, user };
}

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

// Anonymous landing-funnel preview. No profile/job — grounded ONLY in the
// visitor's title + description. Instructs brevity so the teaser is cheap.
export function buildPreviewPrompt(title: string, description: string) {
  const system = [
    'You are a senior proposal writer creating a short, compelling PREVIEW of a client proposal.',
    'Be specific and confident. Do NOT invent client names, budgets, or facts not implied by the brief.',
  ].join(' ');
  const user = [
    `Project title: ${title}`,
    description ? `Project description: ${description}` : '',
    'Write ONLY the opening "Overview" section of a proposal for this project — 2 to 4 short, punchy sentences that show you understand the goal and set up the engagement. Keep it under 120 words.',
    'Then list the headings a full proposal would contain.',
    'Return JSON with keys: sections (array of exactly ONE object {heading (string), body (string)}), lockedTitles (array of 4-6 short section-heading strings like "Scope", "Timeline", "Investment", "Why us", "Next steps"). Return nothing else.',
  ].filter(Boolean).join('\n');
  return { system, user };
}

// Auto-capture: extract durable, reusable facts about the FREELANCER from free text
// (e.g. a won/lost reason) to remember for future proposals. Never fabricate.
export function buildMemoryExtractionPrompt(text: string) {
  const system = [
    'You extract durable, reusable facts about a FREELANCER/agency from their note, to remember for future proposals.',
    'Only extract STABLE facts about THEM (skills, strengths, niche, tools, rates, working preferences) — never about a specific client or one-off details. If nothing durable is present, return an empty array. Never invent.',
  ].join(' ');
  const user = [
    `Note: ${text}`,
    'Return JSON: { facts: array of { category (one of: technical, professional, business, freelancing, writing, personal, goals), key (short snake_case), value (string), confidence (number 0-1) } }. Return nothing else.',
  ].join('\n');
  return { system, user };
}
