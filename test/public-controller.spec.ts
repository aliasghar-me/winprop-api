import { PublicController } from '../src/public/public.controller';

// Unit-only: drive PublicController with fake PublicService + PreviewService.

describe('PublicController', () => {
  it('get delegates to PublicService.getSharedProposal(token)', () => {
    const publicSvc: any = { getSharedProposal: jest.fn().mockReturnValue({ id: 'p1' }) };
    const previewSvc: any = { preview: jest.fn() };
    const ctrl = new PublicController(publicSvc, previewSvc);
    const out = ctrl.get('share-token');
    expect(publicSvc.getSharedProposal).toHaveBeenCalledWith('share-token');
    expect(out).toEqual({ id: 'p1' });
  });

  it('preview delegates to PreviewService.preview(dto)', () => {
    const publicSvc: any = { getSharedProposal: jest.fn() };
    const previewSvc: any = { preview: jest.fn().mockReturnValue({ summary: 's' }) };
    const ctrl = new PublicController(publicSvc, previewSvc);
    const dto = { title: 't', description: 'd' } as any;
    const out = ctrl.preview(dto);
    expect(previewSvc.preview).toHaveBeenCalledWith(dto);
    expect(out).toEqual({ summary: 's' });
  });
});
