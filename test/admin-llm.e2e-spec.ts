import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AllExceptionsFilter } from '../src/common/errors/all-exceptions.filter';

describe('Admin LLM config', () => {
  let app: INestApplication; let prisma: PrismaService;
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true })); app.useGlobalFilters(new AllExceptionsFilter());
    await app.init(); prisma = app.get(PrismaService);
    await prisma.$executeRawUnsafe('TRUNCATE "LlmConfig","SuperAdmin" RESTART IDENTITY CASCADE');
    await prisma.superAdmin.create({ data: { email: 'root@winprop.ai' } });
  });
  afterAll(async () => { await app.close(); });

  it('rejects without the super-admin header', async () => {
    const res = await request(app.getHttpServer()).put('/admin/llm-config').send({ provider: 'anthropic', model: 'claude-opus-4-8', apiKey: 'sk-x' });
    expect(res.status).toBe(403);
  });

  it('stores an encrypted key (never returned) and reports masked status', async () => {
    const set = await request(app.getHttpServer()).put('/admin/llm-config')
      .set({ 'x-super-admin': 'root@winprop.ai' }).send({ provider: 'anthropic', model: 'claude-opus-4-8', apiKey: 'sk-secret' });
    expect(set.status).toBe(200);
    expect(JSON.stringify(set.body)).not.toContain('sk-secret');
    const row = await prisma.llmConfig.findFirst({ where: { orgId: null } });
    expect(row?.apiKeyEncrypted).not.toContain('sk-secret');
    const status = await request(app.getHttpServer()).get('/admin/llm-config').set({ 'x-super-admin': 'root@winprop.ai' });
    expect(status.body.isSet).toBe(true);
    expect(status.body.apiKey).toBeUndefined();
  });
});
