import { DocumentsController } from '../src/documents/documents.controller';

// Unit-only: instantiate the controller with a mocked DocumentsService.
// Focus on delegation, param wiring, and the `dto.type ?? 'proposal'` branch.

function makeService() {
  return {
    generate: jest.fn().mockResolvedValue({ id: 'd1' }),
    getOne: jest.fn().mockResolvedValue({ id: 'd1' }),
    update: jest.fn().mockResolvedValue({ id: 'd1' }),
    listVersions: jest.fn().mockResolvedValue([{ id: 'd1' }]),
    share: jest.fn().mockResolvedValue({ url: 'x' }),
    unshare: jest.fn().mockResolvedValue({ ok: true }),
    regenerateSection: jest.fn().mockResolvedValue({ id: 'd1' }),
    duplicate: jest.fn().mockResolvedValue({ id: 'd2' }),
    adjustTone: jest.fn().mockResolvedValue({ id: 'd1' }),
    adjustPricing: jest.fn().mockResolvedValue({ id: 'd1' }),
  };
}

const user = { orgId: 'org1', userId: 'u1' } as any;
const reservation = { id: 'resv1' };
const req = { quotaReservation: reservation } as any;

describe('DocumentsController', () => {
  let svc: ReturnType<typeof makeService>;
  let ctrl: DocumentsController;

  beforeEach(() => {
    svc = makeService();
    ctrl = new DocumentsController(svc as any);
  });

  describe('generate', () => {
    it('delegates with the explicit dto.type and the quota reservation', () => {
      const out = ctrl.generate(user, 'job1', { type: 'cover-letter' } as any, req);
      expect(svc.generate).toHaveBeenCalledWith('org1', 'job1', 'cover-letter', reservation);
      return expect(out).resolves.toEqual({ id: 'd1' });
    });

    it('defaults type to "proposal" when dto.type is absent', () => {
      ctrl.generate(user, 'job1', {} as any, req);
      expect(svc.generate).toHaveBeenCalledWith('org1', 'job1', 'proposal', reservation);
    });

    it('defaults type to "proposal" when dto.type is undefined explicitly', () => {
      ctrl.generate(user, 'job1', { type: undefined } as any, req);
      expect(svc.generate).toHaveBeenCalledWith('org1', 'job1', 'proposal', reservation);
    });
  });

  it('getOne delegates orgId/jobId/docId', () => {
    ctrl.getOne(user, 'job1', 'doc1');
    expect(svc.getOne).toHaveBeenCalledWith('org1', 'job1', 'doc1');
  });

  it('update delegates the dto', () => {
    const dto = { content: 'x' } as any;
    ctrl.update(user, 'job1', 'doc1', dto);
    expect(svc.update).toHaveBeenCalledWith('org1', 'job1', 'doc1', dto);
  });

  it('versions delegates to listVersions', () => {
    ctrl.versions(user, 'job1', 'doc1');
    expect(svc.listVersions).toHaveBeenCalledWith('org1', 'job1', 'doc1');
  });

  it('share delegates', () => {
    ctrl.share(user, 'job1', 'doc1');
    expect(svc.share).toHaveBeenCalledWith('org1', 'job1', 'doc1');
  });

  it('unshare delegates', () => {
    ctrl.unshare(user, 'job1', 'doc1');
    expect(svc.unshare).toHaveBeenCalledWith('org1', 'job1', 'doc1');
  });

  it('regenerateSection delegates section + reservation', () => {
    ctrl.regenerateSection(user, 'job1', 'doc1', { section: 'intro' } as any, req);
    expect(svc.regenerateSection).toHaveBeenCalledWith('org1', 'job1', 'doc1', 'intro', reservation);
  });

  it('duplicate delegates targetJobId', () => {
    ctrl.duplicate(user, 'job1', 'doc1', { targetJobId: 'job2' } as any);
    expect(svc.duplicate).toHaveBeenCalledWith('org1', 'job1', 'doc1', 'job2');
  });

  it('duplicate passes undefined targetJobId through', () => {
    ctrl.duplicate(user, 'job1', 'doc1', {} as any);
    expect(svc.duplicate).toHaveBeenCalledWith('org1', 'job1', 'doc1', undefined);
  });

  it('adjustTone delegates tone + reservation', () => {
    ctrl.adjustTone(user, 'job1', 'doc1', { tone: 'formal' } as any, req);
    expect(svc.adjustTone).toHaveBeenCalledWith('org1', 'job1', 'doc1', 'formal', reservation);
  });

  it('adjustPricing delegates reservation', () => {
    ctrl.adjustPricing(user, 'job1', 'doc1', req);
    expect(svc.adjustPricing).toHaveBeenCalledWith('org1', 'job1', 'doc1', reservation);
  });
});
