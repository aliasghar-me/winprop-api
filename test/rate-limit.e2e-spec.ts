import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

// Rate limiting is globally skipped in the e2e suite (setup-throttle.ts); re-enable
// it just for this spec to prove the limiter actually fires on the privileged route.
describe('Rate limiting', () => {
  let app: INestApplication; let prev: string | undefined;
  beforeAll(async () => {
    prev = process.env.THROTTLE_DISABLED;
    process.env.THROTTLE_DISABLED = '0';
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init();
  });
  afterAll(async () => { process.env.THROTTLE_DISABLED = prev; await app.close(); });

  it('429s the super-admin login after exceeding 5/min', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) {
      const r = await request(app.getHttpServer()).post('/admin/login').send({ email: 'root@winprop.ai', password: 'whatever' });
      statuses.push(r.status);
    }
    // First 5 attempts pass the limiter (and 401 on bad creds); the rest are throttled.
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
    expect(statuses.slice(0, 5).every((s) => s !== 429)).toBe(true);
  });
});
