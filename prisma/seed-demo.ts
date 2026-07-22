import 'dotenv/config';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// ── Crypto mirrored from src/common/crypto/crypto.service.ts ──────────────────
// User.email/name are AES-256-GCM ciphertext; lookups use an HMAC blind index
// (emailHash). We replicate both so the seeded user logs in through the real API.
const KEY_HEX = process.env.ENCRYPTION_KEY!;
if (!KEY_HEX || KEY_HEX.length !== 64) throw new Error('ENCRYPTION_KEY must be 64 hex chars (32 bytes)');
const KEY = Buffer.from(KEY_HEX, 'hex');
const encrypt = (plain: string): string => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv.toString('hex'), cipher.getAuthTag().toString('hex'), enc.toString('hex')].join(':');
};
const hmac = (value: string): string => crypto.createHmac('sha256', KEY).update(value).digest('hex');

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

const DEMO_EMAIL = 'demo@winprop.dev';
const DEMO_PASSWORD = 'Demo1234!';

// Deterministic AI Job-Intelligence verdict, shaped like the mock provider output.
function intelligence(opts: {
  score: number; recommendation: 'apply' | 'consider' | 'avoid';
  portfolio: number; skills: number; budget: number; competition: 'Low' | 'Medium' | 'High';
  roi: number; budgetUsd: number; weeks: number; redFlags: string[];
}) {
  return {
    objective: 'Deliver a modern, reliable build with a smooth launch and measurable outcomes.',
    domain: 'Web / SaaS',
    seniority: 'Senior',
    complexity: opts.score >= 70 ? 'Medium' : 'High',
    estimatedWeeks: opts.weeks,
    estimatedBudgetUsd: opts.budgetUsd,
    stack: ['Next.js', 'TypeScript', 'PostgreSQL', 'Tailwind CSS'],
    deliverables: ['Discovery & specification', 'Design system & UI', 'Core build', 'QA & accessibility', 'Launch & handover'],
    integrations: ['Auth provider', 'Payments', 'Analytics'],
    risks: [
      { title: 'Scope ambiguity', severity: 'medium', note: 'Several requirements are implied — confirm before fixing the price.' },
      { title: 'Timeline pressure', severity: opts.competition === 'High' ? 'medium' : 'low', note: 'Achievable if discovery starts promptly.' },
    ],
    clarificationQuestions: [
      'What does success look like 90 days after launch?',
      'Are there existing brand or design assets to work from?',
      'Which integrations are must-have for v1 vs later?',
      'Who is the decision-maker and what is the approval process?',
      'Is the stated budget fixed or flexible for the right approach?',
    ],
    winProbability: {
      score: opts.score,
      reasons: ['Strong overlap between the brief and your core skills', 'Budget sits within your typical range'],
      improvements: ['Lead with a directly comparable case study', 'Answer the top clarification question in your opening'],
    },
    recommendation: opts.recommendation,
    fit: { portfolio: opts.portfolio, skills: opts.skills, budget: opts.budget, competition: opts.competition },
    expectedRoiUsdPerHour: opts.roi,
    redFlags: opts.redFlags,
  };
}

// Proposal content shaped like the mock provider's full-proposal output.
function proposal(client: string, job: string, weeks: number, priceUsd: number) {
  return {
    summary: `${client} needs a partner who can deliver ${job} with clarity and momentum. This proposal outlines a focused engagement that ships measurable outcomes while keeping you involved at every milestone.`,
    scope: [
      'Discovery & requirements alignment workshop',
      'Architecture and technical approach sign-off',
      'Iterative build with weekly demo checkpoints',
      'QA, accessibility and performance hardening',
      'Launch support and a 2-week stabilisation window',
    ],
    timelineWeeks: weeks,
    priceUsd,
    closing: `We're excited to help ${client} succeed with ${job}. Once you approve this proposal we can kick off discovery within a week.`,
  };
}

async function wipeDemo() {
  const user = await prisma.user.findUnique({ where: { emailHash: hmac(DEMO_EMAIL) }, include: { memberships: true } });
  if (!user) return;
  const orgIds = user.memberships.map((m) => m.orgId);
  const jobs = await prisma.job.findMany({ where: { orgId: { in: orgIds } }, select: { id: true } });
  const jobIds = jobs.map((j) => j.id);
  const docs = await prisma.document.findMany({ where: { jobId: { in: jobIds } }, select: { id: true } });
  const docIds = docs.map((d) => d.id);
  await prisma.documentVersion.deleteMany({ where: { documentId: { in: docIds } } });
  await prisma.document.deleteMany({ where: { id: { in: docIds } } });
  await prisma.generationLog.deleteMany({ where: { orgId: { in: orgIds } } });
  await prisma.job.deleteMany({ where: { id: { in: jobIds } } });
  await prisma.memoryAuditLog.deleteMany({ where: { orgId: { in: orgIds } } });
  await prisma.userMemory.deleteMany({ where: { orgId: { in: orgIds } } });
  await prisma.quotaPeriod.deleteMany({ where: { orgId: { in: orgIds } } });
  await prisma.subscription.deleteMany({ where: { orgId: { in: orgIds } } });
  await prisma.profile.deleteMany({ where: { orgId: { in: orgIds } } });
  await prisma.membership.deleteMany({ where: { userId: user.id } });
  await prisma.refreshToken.deleteMany({ where: { userId: user.id } });
  await prisma.emailVerificationToken.deleteMany({ where: { userId: user.id } });
  await prisma.org.deleteMany({ where: { id: { in: orgIds } } });
  await prisma.user.delete({ where: { id: user.id } });
}

async function main() {
  await wipeDemo();

  // ── Demo user (verified so generation isn't gated + no VerifyBanner) ────────
  const user = await prisma.user.create({
    data: {
      email: encrypt(DEMO_EMAIL),
      emailHash: hmac(DEMO_EMAIL),
      passwordHash: await bcrypt.hash(DEMO_PASSWORD, 10),
      passwordSetAt: new Date(),
      name: encrypt('Alex Rivera'),
      emailVerifiedAt: new Date(),
      preferredLanguage: 'en',
    },
  });
  const org = await prisma.org.create({
    data: { name: 'Pixel & Pitch Studio', profession: 'developer', plan: 'professional', subStatus: 'active' },
  });
  await prisma.membership.create({ data: { userId: user.id, orgId: org.id, role: 'owner' } });
  await prisma.profile.create({
    data: {
      orgId: org.id,
      agencyName: 'Pixel & Pitch Studio',
      services: ['Web app development', 'SaaS MVPs', 'API & integrations', 'Design systems'],
      skills: ['Next.js', 'TypeScript', 'Node.js', 'PostgreSQL', 'React', 'Tailwind CSS', 'Stripe'],
      priceMin: 8000,
      priceMax: 60000,
      tone: 'premium',
      brandColor: '#4F46E5',
      brandShort: 'PP',
      website: 'https://pixelandpitch.dev',
      contactInfo: 'alex@pixelandpitch.dev',
      portfolioLinks: ['https://pixelandpitch.dev/work/fintech-dashboard', 'https://pixelandpitch.dev/work/marketplace'],
      caseStudies: [
        { title: 'Fintech analytics dashboard', summary: 'Shipped a real-time analytics dashboard that cut reporting time by 80%.', url: 'https://pixelandpitch.dev/work/fintech-dashboard' },
        { title: 'Two-sided marketplace', summary: 'Built and launched a marketplace MVP to 5k users in 10 weeks.', url: 'https://pixelandpitch.dev/work/marketplace' },
      ],
      testimonials: [
        { author: 'Dana Whitfield', quote: 'They delivered ahead of schedule and communicated at every step.', company: 'Northwind SaaS' },
        { author: 'Marco Silva', quote: 'Best contractor we have worked with — clear, fast, senior.', company: 'Lumen Health' },
      ],
    },
  });

  // Fake-but-plausible active subscription so the billing page has content.
  await prisma.subscription.create({
    data: {
      orgId: org.id,
      stripeSubId: 'sub_demo_' + org.id.slice(-8),
      stripePriceId: process.env.STRIPE_PRICE_PRO || 'price_demo_professional',
      status: 'active',
      currentPeriodEnd: new Date(Date.now() + 24 * 24 * 3600 * 1000),
    },
  });

  // ── Jobs across the full "Should I Apply?" → outcome lifecycle ──────────────
  type Spec = {
    title: string; company: string; client: string; clientEmail: string; budget: number; timeline: string;
    description: string; requirements: string; status: any; verdict: ReturnType<typeof intelligence>;
    daysAgo: number; withProposal: boolean; won?: number; outcomeReason?: string;
  };

  const specs: Spec[] = [
    {
      title: 'Next.js SaaS dashboard rebuild', company: 'Northwind SaaS', client: 'Dana Whitfield', clientEmail: 'dana@northwind.io',
      budget: 32000, timeline: '8 weeks', description: 'Rebuild our aging analytics dashboard in Next.js with real-time charts, roles, and a design system.',
      requirements: 'Next.js, TypeScript, charting, RBAC, SSO, tests', status: 'won', daysAgo: 34, withProposal: true, won: 34000,
      outcomeReason: 'Led with the fintech dashboard case study; answered their SSO question up front.',
      verdict: intelligence({ score: 82, recommendation: 'apply', portfolio: 88, skills: 90, budget: 84, competition: 'Medium', roi: 260, budgetUsd: 34000, weeks: 8, redFlags: ['none'] }),
    },
    {
      title: 'Marketplace MVP (two-sided)', company: 'Lumen Health', client: 'Marco Silva', clientEmail: 'marco@lumen.health',
      budget: 45000, timeline: '10 weeks', description: 'Build a two-sided marketplace MVP connecting clinics and specialists, with Stripe Connect payouts.',
      requirements: 'Next.js, Stripe Connect, search, messaging', status: 'won', daysAgo: 62, withProposal: true, won: 48000,
      outcomeReason: 'Strong marketplace portfolio match; proposed a phased v1 that de-risked the timeline.',
      verdict: intelligence({ score: 79, recommendation: 'apply', portfolio: 85, skills: 82, budget: 88, competition: 'Medium', roi: 240, budgetUsd: 48000, weeks: 10, redFlags: ['none'] }),
    },
    {
      title: 'Shopify headless storefront', company: 'Acme Goods', client: 'Priya Nair', clientEmail: 'priya@acmegoods.com',
      budget: 18000, timeline: '5 weeks', description: 'Headless Shopify storefront in Next.js with fast PDPs and a custom checkout.',
      requirements: 'Next.js, Shopify Storefront API, performance', status: 'sent', daysAgo: 4, withProposal: true,
      verdict: intelligence({ score: 74, recommendation: 'apply', portfolio: 72, skills: 80, budget: 78, competition: 'Medium', roi: 220, budgetUsd: 18000, weeks: 5, redFlags: ['none'] }),
    },
    {
      title: 'Internal admin tool + API', company: 'Cobalt Logistics', client: 'Sam Ortega', clientEmail: 'sam@cobalt.co',
      budget: 26000, timeline: '7 weeks', description: 'Internal ops admin with a typed REST API over PostgreSQL and role-based access.',
      requirements: 'Node.js, PostgreSQL, REST, RBAC', status: 'viewed', daysAgo: 2, withProposal: true,
      verdict: intelligence({ score: 76, recommendation: 'apply', portfolio: 80, skills: 84, budget: 74, competition: 'Low', roi: 250, budgetUsd: 26000, weeks: 7, redFlags: ['none'] }),
    },
    {
      title: 'AI chatbot integration', company: 'Bright Digital', client: 'Lena Fox', clientEmail: 'lena@brightdigital.com',
      budget: 12000, timeline: '4 weeks', description: 'Add an AI assistant to an existing help center with retrieval over docs.',
      requirements: 'TypeScript, LLM API, RAG', status: 'proposal_generated', daysAgo: 1, withProposal: true,
      verdict: intelligence({ score: 68, recommendation: 'consider', portfolio: 60, skills: 78, budget: 66, competition: 'High', roi: 190, budgetUsd: 12000, weeks: 4, redFlags: ['Vague success criteria'] }),
    },
    {
      title: 'Crypto "get rich" landing (rush)', company: 'QuickCoin', client: 'Unknown', clientEmail: 'noreply@quickcoin.biz',
      budget: 800, timeline: '2 days', description: 'Need a landing page for our coin launch ASAP. Pay after launch. Huge upside!!!',
      requirements: 'HTML, urgency', status: 'draft', daysAgo: 1, withProposal: false,
      verdict: intelligence({ score: 21, recommendation: 'avoid', portfolio: 30, skills: 40, budget: 12, competition: 'High', roi: 25, budgetUsd: 800, weeks: 1, redFlags: ['Pay-after-launch (non-payment risk)', 'Unrealistic timeline', 'Vague/anonymous client'] }),
    },
    {
      title: 'WordPress blog migration', company: 'Old Media Co', client: 'Terry Blake', clientEmail: 'terry@oldmedia.co',
      budget: 3000, timeline: '3 weeks', description: 'Migrate a large WordPress blog to a new host and theme.',
      requirements: 'WordPress, PHP, migration', status: 'lost', daysAgo: 20, withProposal: true,
      outcomeReason: 'Budget below our floor and stack mismatch; client chose a cheaper generalist.',
      verdict: intelligence({ score: 38, recommendation: 'avoid', portfolio: 25, skills: 30, budget: 20, competition: 'High', roi: 70, budgetUsd: 3000, weeks: 3, redFlags: ['Below rate floor', 'Stack mismatch'] }),
    },
  ];

  let created = 0;
  for (const s of specs) {
    const job = await prisma.job.create({
      data: {
        orgId: org.id,
        title: s.title,
        company: s.company,
        clientName: s.client,
        clientEmail: s.clientEmail,
        clientWebsite: null,
        projectDescription: s.description,
        requirements: s.requirements,
        budget: s.budget,
        timeline: s.timeline,
        intelligenceJson: s.verdict as any,
        status: s.status,
        wonAmountUsd: s.won ?? null,
        outcomeReason: s.outcomeReason ?? null,
        createdAt: new Date(Date.now() - s.daysAgo * 24 * 3600 * 1000),
      },
    });
    created++;

    if (s.withProposal) {
      const content = proposal(s.client, s.title, Math.max(4, Math.round(s.budget / 4500)), s.budget);
      const doc = await prisma.document.create({
        data: {
          jobId: job.id,
          type: 'proposal',
          title: `Proposal — ${s.title}`,
          contentJson: content as any,
          version: 2,
          status: 'ready',
          shareToken: s.status === 'won' || s.status === 'sent' ? 'demo-' + job.id.slice(-10) : null,
          createdAt: new Date(Date.now() - s.daysAgo * 24 * 3600 * 1000),
        },
      });
      // Version history: v1 (draft) then v2 (tone-adjusted).
      await prisma.documentVersion.create({
        data: { documentId: doc.id, version: 1, title: doc.title, contentJson: content as any, label: null,
          createdAt: new Date(Date.now() - (s.daysAgo + 0.2) * 24 * 3600 * 1000) },
      });
      await prisma.documentVersion.create({
        data: { documentId: doc.id, version: 2, title: doc.title, contentJson: content as any, label: 'tone-adjust',
          createdAt: new Date(Date.now() - s.daysAgo * 24 * 3600 * 1000) },
      });
      // Usage/cost log for the generation.
      await prisma.generationLog.create({
        data: { orgId: org.id, jobId: job.id, provider: 'mock', model: 'mock-1', promptTokens: 600, completionTokens: 300,
          costUsd: '0.004500', priceMapVersion: 'demo', createdAt: new Date(Date.now() - s.daysAgo * 24 * 3600 * 1000) },
      });
    }
  }

  // ── Persistent freelancer memory (feeds proposal quality) ───────────────────
  const memories = [
    { category: 'preferences', key: 'tone', value: 'Confident and concise; lead with outcomes, avoid jargon.', source: 'explicit' },
    { category: 'pricing', key: 'rate_floor_usd', value: '80', source: 'explicit' },
    { category: 'pricing', key: 'min_project_usd', value: '5000', source: 'outcome' },
    { category: 'rules', key: 'avoid', value: 'No pay-after-launch or equity-only deals; no WordPress migrations.', source: 'outcome' },
    { category: 'strengths', key: 'best_stack', value: 'Next.js + TypeScript + PostgreSQL SaaS builds (highest win rate).', source: 'outcome' },
  ];
  for (const m of memories) {
    await prisma.userMemory.create({
      data: { orgId: org.id, category: m.category, key: m.key, value: m.value, source: m.source, confidence: 1, isPermanent: true, lastUsedAt: new Date() },
    });
  }

  // Current-period quota counter reflecting the proposals generated.
  const periodStart = new Date();
  periodStart.setUTCDate(1);
  periodStart.setUTCHours(0, 0, 0, 0);
  await prisma.quotaPeriod.create({ data: { orgId: org.id, periodStart, used: 6 } });

  const wonTotal = specs.filter((s) => s.won).reduce((a, s) => a + (s.won || 0), 0);
  console.log('✔ demo seed complete');
  console.log(`  user:  ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  console.log(`  org:   ${org.name} (${org.plan})`);
  console.log(`  jobs:  ${created} (2 won, 1 lost, rest in-flight) — revenue won $${wonTotal.toLocaleString()}`);
  console.log(`  memory: ${memories.length} facts`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
