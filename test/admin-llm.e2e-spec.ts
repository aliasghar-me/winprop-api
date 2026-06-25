import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AllExceptionsFilter } from '../src/common/errors/all-exceptions.filter';

describe('Admin LLM config (real super-admin auth, H3)', () => {
  let app: INestApplication; let prisma: PrismaService; let token: string; let adminId: string;
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true })); app.useGlobalFilters(new AllExceptionsFilter());
    await app.init(); prisma = app.get(PrismaService);
    await prisma.$executeRawUnsafe('TRUNCATE "SuperAdminAuditLog","LlmConfig","SuperAdmin" RESTART IDENTITY CASCADE');
    const admin = await prisma.superAdmin.create({ data: { email: 'root@winprop.ai', passwordHash: await bcrypt.hash('s3cret-pw', 10) } });
    adminId = admin.id;
  });
  afterAll(async () => { await app.close(); });

  it('rejects /admin without a token (no more trusted header)', async () => {
    const res = await request(app.getHttpServer()).put('/admin/llm-config').send({ provider: 'anthropic', model: 'claude-opus-4-8', apiKey: 'sk-x' });
    expect(res.status).toBe(403);
  });

  it('rejects the old x-super-admin header trick', async () => {
    const res = await request(app.getHttpServer()).put('/admin/llm-config')
      .set({ 'x-super-admin': 'root@winprop.ai' }).send({ provider: 'anthropic', model: 'claude-opus-4-8', apiKey: 'sk-x' });
    expect(res.status).toBe(403);
  });

  it('rejects a wrong password with 401', async () => {
    const res = await request(app.getHttpServer()).post('/admin/login').send({ email: 'root@winprop.ai', password: 'nope' });
    expect(res.status).toBe(401);
  });

  it('logs in for a token', async () => {
    const res = await request(app.getHttpServer()).post('/admin/login').send({ email: 'root@winprop.ai', password: 's3cret-pw' });
    expect(res.status).toBe(201);
    expect(typeof res.body.token).toBe('string');
    token = res.body.token;
  });

  it('rejects a garbage bearer token', async () => {
    const res = await request(app.getHttpServer()).get('/admin/orgs').set({ Authorization: 'Bearer not-a-jwt' });
    expect(res.status).toBe(403);
  });

  it('stores an encrypted key (never returned), reports masked status, and audit-logs the action', async () => {
    const set = await request(app.getHttpServer()).put('/admin/llm-config')
      .set({ Authorization: `Bearer ${token}` }).send({ provider: 'anthropic', model: 'claude-opus-4-8', apiKey: 'sk-secret' });
    expect(set.status).toBe(200);
    expect(JSON.stringify(set.body)).not.toContain('sk-secret');
    const row = await prisma.llmConfig.findFirst({ where: { orgId: null } });
    expect(row?.apiKeyEncrypted).not.toContain('sk-secret');

    const status = await request(app.getHttpServer()).get('/admin/llm-config').set({ Authorization: `Bearer ${token}` });
    expect(status.body.isSet).toBe(true);
    expect(status.body.apiKey).toBeUndefined();

    // Audit trail recorded who did what — but never the secret-bearing body.
    const logs = await prisma.superAdminAuditLog.findMany({ where: { superAdminId: adminId } });
    expect(logs.length).toBeGreaterThanOrEqual(2); // the PUT and the GET
    expect(logs.some((l) => l.action === 'PUT /admin/llm-config')).toBe(true);
    expect(JSON.stringify(logs)).not.toContain('sk-secret');
  });
});
