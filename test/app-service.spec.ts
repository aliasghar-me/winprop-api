import { AppService } from '../src/app.service';

// Unit-only: trivial service, just exercise its method.
describe('AppService', () => {
  it('getHello returns the greeting', () => {
    expect(new AppService().getHello()).toBe('Hello World!');
  });
});
