import { ProfileService } from '../src/profile/profile.service';

// Unit-only: hand-rolled fake PrismaService (no DB). Covers the not-found branch
// on get() and the undefined-skip branch in update().
function makeSvc(profile: any) {
  const prisma: any = {
    profile: {
      findUnique: jest.fn().mockResolvedValue(profile),
      update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ orgId: 'o1', ...data })),
    },
  };
  return { svc: new ProfileService(prisma), prisma };
}

describe('ProfileService (unit)', () => {
  it('get() returns the profile when it exists', async () => {
    const { svc } = makeSvc({ orgId: 'o1', agencyName: 'Studio' });
    await expect(svc.get('o1')).resolves.toEqual({ orgId: 'o1', agencyName: 'Studio' });
  });

  it('get() throws NOT_FOUND when the profile is missing', async () => {
    const { svc } = makeSvc(null);
    await expect(svc.get('o1')).rejects.toMatchObject({ code: 'NOT_FOUND', translationKey: 'errors.profileNotFound' });
  });

  it('update() skips undefined fields and passes defined ones straight through', async () => {
    const { svc, prisma } = makeSvc({ orgId: 'o1' });
    const res = await svc.update('o1', { agencyName: 'ACME', website: undefined } as any);
    const data = prisma.profile.update.mock.calls[0][0].data;
    expect(data).toEqual({ agencyName: 'ACME' }); // undefined website skipped
    expect(res).toMatchObject({ agencyName: 'ACME' });
  });

  it('update() first checks existence (throws NOT_FOUND before updating)', async () => {
    const { svc, prisma } = makeSvc(null);
    await expect(svc.update('o1', { agencyName: 'ACME' } as any)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(prisma.profile.update).not.toHaveBeenCalled();
  });
});
