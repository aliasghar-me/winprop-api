import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AllExceptionsFilter } from '../src/common/errors/all-exceptions.filter';
import { LlmService } from '../src/llm/llm.service';
import { AppException } from '../src/common/errors/app-exception';

describe('Documents — failure does not consume quota', () => {
  let app: INestApplication; let prisma: PrismaService; let token: string; let jobId: string;
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(LlmService).useValue({
        generateProposal: jest.fn().mockRejectedValue(new AppException(502, 'LLM_PROVIDER_ERROR', 'boom')),
      }).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true })); app.useGlobalFilters(new AllExceptionsFilter());
    await app.init(); prisma = app.get(PrismaService);
    await prisma.$executeRawUnsafe('TRUNCATE "GenerationLog","Document","Profile","Membership","Job","Subscription","Org","User" RESTART IDENTITY CASCADE');
    const su = await request(app.getHttpServer()).post('/auth/signup').send({ email: 'o@x.com', password: 'pw1234567', name: 'O', agencyName: 'S', profession: 'developer' });
    token = su.body.accessToken;
    const job = await request(app.getHttpServer()).post('/jobs').set({ Authorization: `Bearer ${token}` }).send({ title: 'Acme' });
    jobId = job.body.id;
  });
  afterAll(async () => { await app.close(); });

  it('returns LLM_PROVIDER_ERROR and writes no Document or GenerationLog', async () => {
    const res = await request(app.getHttpServer()).post(`/jobs/${jobId}/documents`).set({ Authorization: `Bearer ${token}` }).send({ type: 'proposal' });
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('LLM_PROVIDER_ERROR');
    expect(await prisma.document.count()).toBe(0);
    expect(await prisma.generationLog.count()).toBe(0);
  });
});
