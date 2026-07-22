import { BillingController } from '../src/billing/billing.controller';

// Unit-only: drive BillingController with a fake BillingService.

describe('BillingController', () => {
  it('checkout delegates to BillingService.createCheckout(orgId, plan)', () => {
    const billing: any = { createCheckout: jest.fn().mockReturnValue({ url: 'u' }) };
    const ctrl = new BillingController(billing);
    const out = ctrl.checkout({ orgId: 'o1' } as any, { plan: 'starter' } as any);
    expect(billing.createCheckout).toHaveBeenCalledWith('o1', 'starter');
    expect(out).toEqual({ url: 'u' });
  });

  it('portal delegates to BillingService.createPortal(orgId)', () => {
    const billing: any = { createPortal: jest.fn().mockReturnValue({ url: 'p' }) };
    const ctrl = new BillingController(billing);
    const out = ctrl.portal({ orgId: 'o2' } as any);
    expect(billing.createPortal).toHaveBeenCalledWith('o2');
    expect(out).toEqual({ url: 'p' });
  });

  it('status delegates to BillingService.getStatus(orgId)', () => {
    const billing: any = { getStatus: jest.fn().mockReturnValue({ active: true }) };
    const ctrl = new BillingController(billing);
    const out = ctrl.status({ orgId: 'o3' } as any);
    expect(billing.getStatus).toHaveBeenCalledWith('o3');
    expect(out).toEqual({ active: true });
  });

  describe('webhook', () => {
    it('uses rawBody when present', () => {
      const billing: any = { ingestEvent: jest.fn().mockReturnValue({ received: true }) };
      const ctrl = new BillingController(billing);
      const raw = Buffer.from('raw-payload');
      const out = ctrl.webhook({ rawBody: raw, body: { parsed: true } } as any, 'sig-1');
      expect(billing.ingestEvent).toHaveBeenCalledWith(raw, 'sig-1');
      expect(out).toEqual({ received: true });
    });

    it('falls back to req.body when rawBody is absent (?? branch)', () => {
      const billing: any = { ingestEvent: jest.fn().mockReturnValue({ received: true }) };
      const ctrl = new BillingController(billing);
      const out = ctrl.webhook({ body: { parsed: true } } as any, 'sig-2');
      expect(billing.ingestEvent).toHaveBeenCalledWith({ parsed: true }, 'sig-2');
      expect(out).toEqual({ received: true });
    });
  });
});
