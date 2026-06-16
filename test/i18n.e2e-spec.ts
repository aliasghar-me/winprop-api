import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AllExceptionsFilter } from '../src/common/errors/all-exceptions.filter';

const EN_DUPLICATE = 'You already have a job named "Acme Corp". Names must be unique.';
const EN_INVALID_CREDS = 'Invalid email or password.';

async function signup(app: INestApplication, email: string) {
  const res = await request(app.getHttpServer())
    .post('/auth/signup')
    .send({ email, password: 'pw1234567', name: 'Test', agencyName: 'TestAgency', profession: 'developer' });
  return res.body.accessToken as string;
}

describe('i18n error localization', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "Profile","Membership","Job","Document","Org","User" RESTART IDENTITY CASCADE',
    );
    token = await signup(app, 'i18n@x.com');
    // Create the first job so duplicate can be triggered
    await request(app.getHttpServer())
      .post('/jobs')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Acme Corp' });
  });

  afterAll(async () => { await app.close(); });

  it('DUPLICATE_NAME en: returns English message', async () => {
    const res = await request(app.getHttpServer())
      .post('/jobs')
      .set('Authorization', `Bearer ${token}`)
      .set('Accept-Language', 'en')
      .send({ title: 'Acme Corp' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DUPLICATE_NAME');
    expect(res.body.message).toBe(EN_DUPLICATE);
  });

  it('DUPLICATE_NAME ur: returns non-empty Urdu message different from English', async () => {
    const res = await request(app.getHttpServer())
      .post('/jobs')
      .set('Authorization', `Bearer ${token}`)
      .set('Accept-Language', 'ur')
      .send({ title: 'Acme Corp' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DUPLICATE_NAME');
    expect(res.body.message).toBeTruthy();
    expect(res.body.message).not.toBe(EN_DUPLICATE);
  });

  it('DUPLICATE_NAME xx (unsupported locale): falls back to English message', async () => {
    const res = await request(app.getHttpServer())
      .post('/jobs')
      .set('Authorization', `Bearer ${token}`)
      .set('Accept-Language', 'xx')
      .send({ title: 'Acme Corp' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DUPLICATE_NAME');
    expect(res.body.message).toBe(EN_DUPLICATE);
  });

  it('UNAUTHORIZED fr: bad login returns French message different from English', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .set('Accept-Language', 'fr')
      .send({ email: 'i18n@x.com', password: 'wrongpassword' });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
    expect(res.body.message).toBeTruthy();
    expect(res.body.message).not.toBe(EN_INVALID_CREDS);
  });
});
