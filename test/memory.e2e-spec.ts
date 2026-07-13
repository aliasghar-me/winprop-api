import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { I18nValidationPipe } from 'nestjs-i18n';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AllExceptionsFilter } from '../src/common/errors/all-exceptions.filter';

// End-to-end coverage for the UserMemory CRUD API. Real AppModule + pipe/filter,
// signup for a JWT, TRUNCATE at start so the run is deterministic on the dev DB.
describe('Memory CRUD (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;
  const auth = () => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new I18nValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    prisma = app.get(PrismaService);

    await prisma.$executeRawUnsafe(
      'TRUNCATE "MemoryAuditLog","UserMemory","QuotaPeriod","GenerationLog","Document","Profile","Membership","Job","Subscription","Org","User" RESTART IDENTITY CASCADE',
    );
    const su = await request(app.getHttpServer())
      .post('/auth/signup')
      .send({ email: 'mem@x.com', password: 'pw1234567', name: 'M', agencyName: 'S', profession: 'developer' });
    token = su.body.accessToken;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('creates a fact, lists it, and groups it under categories', async () => {
    const created = await request(app.getHttpServer())
      .post('/memory')
      .set(auth())
      .send({ category: 'tone', key: 'style', value: 'friendly and direct' });
    expect(created.status).toBe(201);
    expect(created.body.id).toBeTruthy();
    expect(created.body.source).toBe('manual');
    expect(created.body.confidence).toBe(1);

    const list = await request(app.getHttpServer()).get('/memory').set(auth());
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].value).toBe('friendly and direct');

    const cats = await request(app.getHttpServer()).get('/memory/categories').set(auth());
    expect(cats.status).toBe(200);
    expect(cats.body).toEqual([{ category: 'tone', count: 1 }]);
  });

  it('upserts on the same (category,key) instead of duplicating', async () => {
    const again = await request(app.getHttpServer())
      .post('/memory')
      .set(auth())
      .send({ category: 'tone', key: 'style', value: 'warm', confidence: 0.8 });
    expect(again.status).toBe(201);
    const list = await request(app.getHttpServer()).get('/memory').set(auth());
    expect(list.body).toHaveLength(1);
    expect(list.body[0].value).toBe('warm');
    expect(list.body[0].confidence).toBe(0.8);
  });

  it('patches a fact', async () => {
    const list = await request(app.getHttpServer()).get('/memory').set(auth());
    const id = list.body[0].id;
    const patched = await request(app.getHttpServer()).patch(`/memory/${id}`).set(auth()).send({ value: 'crisp' });
    expect(patched.status).toBe(200);
    expect(patched.body.value).toBe('crisp');
  });

  it('round-trips a sensitive value (stored encrypted, returned decrypted)', async () => {
    const created = await request(app.getHttpServer())
      .post('/memory')
      .set(auth())
      .send({ category: 'rates', key: 'hourly', value: '250', sensitive: true });
    expect(created.status).toBe(201);
    expect(created.body.value).toBe('250'); // decrypted on the way out

    // Stored ciphertext must NOT be the plaintext.
    const raw = await prisma.userMemory.findFirst({ where: { category: 'rates', key: 'hourly' } });
    expect(raw?.value).not.toBe('250');
    expect(raw?.sensitive).toBe(true);

    const list = await request(app.getHttpServer()).get('/memory').set(auth());
    const rates = list.body.find((r: any) => r.category === 'rates');
    expect(rates.value).toBe('250');
  });

  it('soft-deletes a single fact so it drops out of the list', async () => {
    const list = await request(app.getHttpServer()).get('/memory').set(auth());
    const rates = list.body.find((r: any) => r.category === 'rates');
    const del = await request(app.getHttpServer()).delete(`/memory/${rates.id}`).set(auth());
    expect(del.status).toBe(200);
    const after = await request(app.getHttpServer()).get('/memory').set(auth());
    expect(after.body.find((r: any) => r.category === 'rates')).toBeUndefined();
  });

  it('clears all remaining facts via DELETE /memory', async () => {
    const del = await request(app.getHttpServer()).delete('/memory').set(auth());
    expect(del.status).toBe(200);
    const after = await request(app.getHttpServer()).get('/memory').set(auth());
    expect(after.body).toHaveLength(0);
  });

  it('exports the (non-deleted) memory in the portable shape', async () => {
    await request(app.getHttpServer())
      .post('/memory')
      .set(auth())
      .send({ category: 'boilerplate', key: 'intro', value: 'We build fast.' });
    const exp = await request(app.getHttpServer()).get('/memory/export').set(auth());
    expect(exp.status).toBe(200);
    expect(exp.body).toHaveLength(1);
    expect(exp.body[0]).toEqual(
      expect.objectContaining({
        category: 'boilerplate',
        key: 'intro',
        value: 'We build fast.',
        source: 'manual',
        isPermanent: true,
        sensitive: false,
      }),
    );
    expect(exp.body[0]).not.toHaveProperty('id');
  });

  it('imports facts in bulk and they show up in the list', async () => {
    const imp = await request(app.getHttpServer())
      .post('/memory/import')
      .set(auth())
      .send({
        facts: [
          { category: 'technical', key: 'stack', value: 'Next.js + NestJS' },
          { category: 'business', key: 'niche', value: 'fintech', confidence: 0.8, source: 'explicit' },
        ],
      });
    expect(imp.status).toBe(201);
    expect(imp.body).toEqual({ imported: 2 });

    const list = await request(app.getHttpServer()).get('/memory').set(auth());
    const stack = list.body.find((r: any) => r.category === 'technical' && r.key === 'stack');
    expect(stack.value).toBe('Next.js + NestJS');
    const niche = list.body.find((r: any) => r.category === 'business' && r.key === 'niche');
    expect(niche.source).toBe('explicit');
  });

  it('returns the audit trail with entries after creates/imports/deletes', async () => {
    const audit = await request(app.getHttpServer()).get('/memory/audit').set(auth());
    expect(audit.status).toBe(200);
    expect(Array.isArray(audit.body)).toBe(true);
    expect(audit.body.length).toBeGreaterThan(0);
    const actions = audit.body.map((e: any) => e.action);
    expect(actions).toContain('imported');
    expect(actions).toContain('created');
    // newest-first ordering
    const times = audit.body.map((e: any) => new Date(e.createdAt).getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it('rejects an invalid body with 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/memory')
      .set(auth())
      .send({ category: 'x', key: 'y', value: 'z', confidence: 5 }); // confidence > 1
    expect(res.status).toBe(400);

    const missing = await request(app.getHttpServer()).post('/memory').set(auth()).send({ category: 'x' });
    expect(missing.status).toBe(400);
  });
});
