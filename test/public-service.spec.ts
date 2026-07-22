import { PublicService } from '../src/public/public.service';

// Unit-only: hand-rolled PrismaService fake. Covers the not-found throw, the
// brand-present projection, and the null-profile branch.
function makePrisma(doc: any) {
  return { document: { findUnique: jest.fn().mockResolvedValue(doc) } } as any;
}

const BASE_DOC = {
  title: 'My Proposal',
  contentJson: { blocks: [] },
  updatedAt: new Date('2026-01-02'),
  job: { org: { profile: null } },
};

describe('PublicService.getSharedProposal', () => {
  it('throws NOT_FOUND when no document matches the share token', async () => {
    const prisma = makePrisma(null);
    const svc = new PublicService(prisma);
    await expect(svc.getSharedProposal('missing')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      translationKey: 'errors.documentNotFound',
    });
    expect(prisma.document.findUnique).toHaveBeenCalledWith({
      where: { shareToken: 'missing' },
      include: { job: { include: { org: { include: { profile: true } } } } },
    });
  });

  it('returns the recipient projection with brand when a profile exists', async () => {
    const profile = { agencyName: 'ACME', logoUrl: 'logo.png', brandColor: '#123', brandShort: 'ACM' };
    const svc = new PublicService(makePrisma({ ...BASE_DOC, job: { org: { profile } } }));
    const out = await svc.getSharedProposal('tok');
    expect(out).toEqual({
      title: 'My Proposal',
      contentJson: { blocks: [] },
      updatedAt: BASE_DOC.updatedAt,
      brand: { agencyName: 'ACME', logoUrl: 'logo.png', brandColor: '#123', brandShort: 'ACM' },
    });
  });

  it('returns brand=null when the org has no profile', async () => {
    const svc = new PublicService(makePrisma({ ...BASE_DOC }));
    const out = await svc.getSharedProposal('tok');
    expect(out.brand).toBeNull();
    expect(out.title).toBe('My Proposal');
  });
});
