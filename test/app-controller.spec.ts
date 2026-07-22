import { AppController } from '../src/app.controller';
import { HealthController } from '../src/health/health.controller';

// Unit-only: trivial controllers.

describe('AppController', () => {
  it('getHello delegates to AppService.getHello()', () => {
    const appService: any = { getHello: jest.fn().mockReturnValue('Hello World!') };
    const ctrl = new AppController(appService);
    expect(ctrl.getHello()).toBe('Hello World!');
    expect(appService.getHello).toHaveBeenCalled();
  });
});

describe('HealthController', () => {
  it('check returns { status: "ok" }', () => {
    const ctrl = new HealthController();
    expect(ctrl.check()).toEqual({ status: 'ok' });
  });
});
