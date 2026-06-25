import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AllExceptionsFilter } from '../src/common/errors/all-exceptions.filter';
import { LlmService } from '../src/llm/llm.service';

async function setup(llmText: string) {
  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(LlmService).useValue({
      generateProposal: jest.fn().mockResolvedValue({
        text: llmText, provider: 'anthropic', model: 'claude-opus-4-8',
        promptTokens: 10, completionTokens: 10, costUsd: 0.001, priceMapVersion: 'v',
      }),
    }).compile();
  const app = mod.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true })); app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  const prisma = app.get(PrismaService);
  await prisma.$executeRawUnsafe('TRUNCATE "QuotaPeriod","GenerationLog","Document","Profile","Membership","Job","Subscription","Org","User" RESTART IDENTITY CASCADE');
  const su = await request(app.getHttpServer()).post('/auth/signup').send({ email: 'm@x.com', password: 'pw1234567', name: 'M', agencyName: 'S', profession: 'developer' });
  const token = su.body.accessToken;
  const job = await request(app.getHttpServer()).post('/jobs').set({ Authorization: `Bearer ${token}` }).send({ title: 'J' });
  return { app, prisma, token, jobId: job.body.id };
}

describe('Documents — malformed/empty LLM output', () => {
  it('malformed JSON → 502 LLM_PROVIDER_ERROR, nothing written', async () => {
    const { app, prisma, token, jobId } = await setup('this is not json at all');
    const res = await request(app.getHttpServer()).post(`/jobs/${jobId}/documents`).set({ Authorization: `Bearer ${token}` }).send({ type: 'proposal' });
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('LLM_PROVIDER_ERROR');
    expect(await prisma.document.count()).toBe(0);
    expect(await prisma.generationLog.count()).toBe(0);
    await app.close();
  });

  it('empty/summary-less JSON → 502 LLM_PROVIDER_ERROR, nothing written', async () => {
    const { app, prisma, token, jobId } = await setup('{"scope":[],"priceUsd":1}');
    const res = await request(app.getHttpServer()).post(`/jobs/${jobId}/documents`).set({ Authorization: `Bearer ${token}` }).send({ type: 'proposal' });
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('LLM_PROVIDER_ERROR');
    expect(await prisma.document.count()).toBe(0);
    expect(await prisma.generationLog.count()).toBe(0);
    await app.close();
  });
});
