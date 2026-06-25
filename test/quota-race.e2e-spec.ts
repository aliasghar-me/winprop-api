import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AllExceptionsFilter } from '../src/common/errors/all-exceptions.filter';
import { LlmService } from '../src/llm/llm.service';

// H2: the old guard counted GenerationLog rows then inserted — two requests at the
// boundary could both pass the COUNT before either wrote. The atomic reserve must
// make that impossible even under full concurrency.
describe('Quota — concurrent reserve cannot exceed the plan limit', () => {
  let app: INestApplication; let prisma: PrismaService;
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LlmService).useValue({
        generateProposal: jest.fn().mockResolvedValue({
          text: '{"summary":"ok","scope":["a"],"timelineWeeks":6,"priceUsd":24000,"closing":"t"}',
          provider: 'anthropic', model: 'm', promptTokens: 10, completionTokens: 10, costUsd: 0.01, priceMapVersion: 'v',
        }),
      }).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true })); app.useGlobalFilters(new AllExceptionsFilter());
    await app.init(); prisma = app.get(PrismaService);
    await prisma.$executeRawUnsafe('TRUNCATE "QuotaPeriod","GenerationLog","Document","Profile","Membership","Job","Subscription","Org","User" RESTART IDENTITY CASCADE');
  });
  afterAll(async () => { await app.close(); });

  it('fires 8 generations at a free org (limit 3) at once: exactly 3 pass, 5 are 429', async () => {
    const su = await request(app.getHttpServer()).post('/auth/signup').send({ email: 'race@x.com', password: 'pw1234567', name: 'R', agencyName: 'S', profession: 'developer' });
    const t = su.body.accessToken;
    const job = await request(app.getHttpServer()).post('/jobs').set({ Authorization: `Bearer ${t}` }).send({ title: 'Race Job' });
    const jid = job.body.id;

    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        request(app.getHttpServer()).post(`/jobs/${jid}/documents`).set({ Authorization: `Bearer ${t}` }).send({ type: 'proposal' }),
      ),
    );
    const ok = results.filter((r) => r.status === 201).length;
    const blocked = results.filter((r) => r.status === 429).length;
    expect(ok).toBe(3);
    expect(blocked).toBe(5);
    // The authoritative counter never overshoots the limit.
    const counter = await prisma.quotaPeriod.findFirst();
    expect(counter?.used).toBe(3);
    expect(await prisma.generationLog.count()).toBe(3);
  });
});
