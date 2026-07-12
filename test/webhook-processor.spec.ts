import { WebhookProcessor } from '../src/billing/webhook.processor';

// Unit-only: the processor is a thin scheduler around BillingService.drainPending.
// Drive its lifecycle hooks and the overlap/error guards with a fake billing service.

describe('WebhookProcessor (unit)', () => {
  const makeBilling = (drain = jest.fn().mockResolvedValue(0)) => ({ drainPending: drain } as any);

  it('runs a startup drain on init and installs an interval (default interval > 0)', async () => {
    const drain = jest.fn().mockResolvedValue(0);
    const proc = new WebhookProcessor(makeBilling(drain));
    await proc.onModuleInit();
    expect(drain).toHaveBeenCalledTimes(1); // startup recovery tick
    expect((proc as any).timer).toBeDefined();
    proc.onModuleDestroy(); // clears the interval
  });

  it('onModuleDestroy is a no-op when no timer was set', () => {
    const proc = new WebhookProcessor(makeBilling());
    expect(() => proc.onModuleDestroy()).not.toThrow();
  });

  it('tick() never overlaps a running drain', async () => {
    const drain = jest.fn().mockResolvedValue(0);
    const proc = new WebhookProcessor(makeBilling(drain));
    (proc as any).running = true;
    await (proc as any).tick();
    expect(drain).not.toHaveBeenCalled();
  });

  it('tick() swallows drain errors and resets the running flag', async () => {
    const drain = jest.fn().mockRejectedValue(new Error('drain failed'));
    const proc = new WebhookProcessor(makeBilling(drain));
    const errSpy = jest.spyOn((proc as any).logger, 'error').mockImplementation(() => undefined);
    await (proc as any).tick();
    expect(errSpy).toHaveBeenCalled();
    expect((proc as any).running).toBe(false);
  });

  it('logs a non-Error rejection value verbatim (?? fallback)', async () => {
    const drain = jest.fn().mockRejectedValue('plain string failure');
    const proc = new WebhookProcessor(makeBilling(drain));
    const errSpy = jest.spyOn((proc as any).logger, 'error').mockImplementation(() => undefined);
    await (proc as any).tick();
    expect(errSpy.mock.calls[0][0]).toContain('plain string failure');
  });

  it('does not install an interval when WEBHOOK_DRAIN_INTERVAL_MS=0', async () => {
    await jest.isolateModulesAsync(async () => {
      const prev = process.env.WEBHOOK_DRAIN_INTERVAL_MS;
      process.env.WEBHOOK_DRAIN_INTERVAL_MS = '0';
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { WebhookProcessor: WP } = require('../src/billing/webhook.processor');
      const drain = jest.fn().mockResolvedValue(0);
      const proc = new WP({ drainPending: drain });
      await proc.onModuleInit();
      expect(drain).toHaveBeenCalledTimes(1);
      expect(proc.timer).toBeUndefined();
      process.env.WEBHOOK_DRAIN_INTERVAL_MS = prev;
    });
  });
});
