import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { I18nValidationPipe } from 'nestjs-i18n';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/errors/all-exceptions.filter';

// H8: class-validator messages are localized by the request language, while keeping
// the standard { statusCode, code, message } envelope.
describe('Validation message localization', () => {
  let app: INestApplication;
  const badEmailBody = { email: 'not-an-email', password: 'pw1234567', name: 'X', agencyName: 'Y', profession: 'developer' };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new I18nValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });
  afterAll(async () => { await app.close(); });

  it('en: returns the English validation message in our envelope', async () => {
    const res = await request(app.getHttpServer()).post('/auth/signup').set('Accept-Language', 'en').send(badEmailBody);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION');
    expect(res.body.message).toContain('valid email address');
  });

  it('fr: localizes the validation message', async () => {
    const res = await request(app.getHttpServer()).post('/auth/signup').set('Accept-Language', 'fr').send(badEmailBody);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION');
    expect(res.body.message).toContain('e-mail valide');
    expect(res.body.message).not.toContain('valid email address');
  });

  it('ur: localizes the validation message (different from English)', async () => {
    const res = await request(app.getHttpServer()).post('/auth/signup').set('Accept-Language', 'ur').send(badEmailBody);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION');
    expect(res.body.message).toBeTruthy();
    expect(res.body.message).not.toContain('valid email address');
  });

  it('xx (unsupported): falls back to English', async () => {
    const res = await request(app.getHttpServer()).post('/auth/signup').set('Accept-Language', 'xx').send(badEmailBody);
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('valid email address');
  });
});
