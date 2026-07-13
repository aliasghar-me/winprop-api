import type { Profile } from '@prisma/client';

// A NEUTRAL, empty studio profile for anonymous verdicts/proposals. Carries NO
// personal data — the anon "Should I Apply?" verdict is grounded only in the job
// text the visitor pasted, not in any saved profile. Shaped to satisfy the
// `Profile` type the LLM prompt builders expect; empty services/skills mean the
// model judges the opportunity on its own merits.
export const NEUTRAL_PROFILE: Profile & { profession?: string } = {
  id: 'anon',
  orgId: 'anon',
  services: [],
  skills: [],
  priceMin: 0,
  priceMax: 0,
  tone: 'professional',
  brandColor: '#6366F1',
  brandShort: 'WP',
  agencyName: 'an independent freelancer',
  logoUrl: null,
  website: null,
  contactInfo: null,
  portfolioLinks: [],
  caseStudies: null,
  testimonials: null,
  profession: undefined,
};
