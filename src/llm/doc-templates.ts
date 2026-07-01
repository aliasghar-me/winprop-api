import { Profile, Job } from '@prisma/client';
import { analysisContext, proofContext } from './prompt.builder';

// Template registry for document types beyond the proposal (Tier 3). Each type
// declares ordered fields; the same descriptor drives generation, validation,
// per-field regenerate, and PDF rendering. Proposal keeps its own dedicated path.
export type FieldType = 'text' | 'list' | 'number' | 'money';
export interface DocField { key: string; label: string; type: FieldType }
export interface DocTemplate { label: string; titlePrefix: string; fields: DocField[] }

export const DOC_TEMPLATES: Record<'sow' | 'estimate', DocTemplate> = {
  sow: {
    label: 'Statement of Work',
    titlePrefix: 'SOW',
    fields: [
      { key: 'overview', label: 'Overview', type: 'text' },
      { key: 'deliverables', label: 'Deliverables', type: 'list' },
      { key: 'milestones', label: 'Milestones', type: 'list' },
      { key: 'assumptions', label: 'Assumptions', type: 'list' },
      { key: 'timelineWeeks', label: 'Timeline (weeks)', type: 'number' },
      { key: 'priceUsd', label: 'Price', type: 'money' },
    ],
  },
  estimate: {
    label: 'Estimate',
    titlePrefix: 'Estimate',
    fields: [
      { key: 'summary', label: 'Summary', type: 'text' },
      { key: 'lineItems', label: 'Line items', type: 'list' },
      { key: 'timelineWeeks', label: 'Timeline (weeks)', type: 'number' },
      { key: 'priceUsd', label: 'Total (USD)', type: 'money' },
      { key: 'notes', label: 'Notes', type: 'text' },
    ],
  },
};

export type RegistryDocType = keyof typeof DOC_TEMPLATES;
export const isRegistryDocType = (t: string): t is RegistryDocType => t in DOC_TEMPLATES;

const jsonType = (t: FieldType) =>
  t === 'list' ? 'an array of short strings' : t === 'text' ? 'a string' : t === 'money' ? 'a number in USD' : 'a number';

const fieldSpec = (fields: DocField[]) => fields.map((f) => `${f.key} (${jsonType(f.type)})`).join(', ');

export function buildDocPrompt(profile: Profile & { profession?: string }, job: Job, type: RegistryDocType) {
  const tpl = DOC_TEMPLATES[type];
  const system = [
    `You are a senior ${tpl.label} writer for ${profile.agencyName}, a ${profile.profession ?? 'professional'} studio.`,
    `Write in a ${profile.tone} tone. Be specific and client-ready.`,
    `Keep pricing within $${profile.priceMin}-$${profile.priceMax} unless the brief clearly demands otherwise.`,
  ].join(' ');
  const user = [
    `Write a complete ${tpl.label} for the job "${job.title}" (client: ${job.company}).`,
    job.projectDescription ? `Project: ${job.projectDescription}` : '',
    job.requirements ? `Requirements: ${job.requirements}` : '',
    `Our services: ${profile.services.join(', ')}. Our skills: ${profile.skills.join(', ')}.`,
    analysisContext(job),
    proofContext(profile),
    `Return JSON with keys: ${fieldSpec(tpl.fields)}. Return nothing else.`,
  ].filter(Boolean).join('\n');
  return { system, user };
}

export function buildDocFieldPrompt(
  profile: Profile & { profession?: string },
  job: Job,
  type: RegistryDocType,
  fieldKey: string,
  current: Record<string, unknown>,
) {
  const field = DOC_TEMPLATES[type].fields.find((f) => f.key === fieldKey);
  if (!field) throw new Error(`Unknown field ${fieldKey} for ${type}`);
  const system = `You are a senior ${DOC_TEMPLATES[type].label} writer for ${profile.agencyName}. Write in a ${profile.tone} tone.`;
  const user = [
    `Regenerate ONLY the "${fieldKey}" field of this ${DOC_TEMPLATES[type].label} for "${job.title}" (client: ${job.company}).`,
    `Current document: ${JSON.stringify(current)}.`,
    `Return JSON with a single key "value" whose value is ${jsonType(field.type)}. Return nothing else.`,
  ].join('\n');
  return { system, user };
}

// Structural validation: every field present with the right JS type.
export function validateDoc(type: RegistryDocType, json: unknown): json is Record<string, unknown> {
  if (!json || typeof json !== 'object') return false;
  const obj = json as Record<string, unknown>;
  return DOC_TEMPLATES[type].fields.every((f) => {
    const v = obj[f.key];
    if (f.type === 'list') return Array.isArray(v);
    if (f.type === 'number' || f.type === 'money') return typeof v === 'number';
    return typeof v === 'string';
  });
}
