import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { I18nValidationPipe } from 'nestjs-i18n';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AllExceptionsFilter } from '../src/common/errors/all-exceptions.filter';

describe('Profile — read + rich update', () => {
  let app: INestApplication; let prisma: PrismaService; let token: string;
  const auth = () => ({ Authorization: `Bearer ${token}` });
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(new I18nValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init(); prisma = app.get(PrismaService);
    await prisma.$executeRawUnsafe('TRUNCATE "Profile","Membership","Job","Subscription","Org","User" RESTART IDENTITY CASCADE');
    const su = await request(app.getHttpServer()).post('/auth/signup').send({ email: 'p@x.com', password: 'pw1234567', name: 'P', agencyName: 'Studio', profession: 'designer' });
    token = su.body.accessToken;
  });
  afterAll(async () => { await app.close(); });

  it('returns the profile created at signup', async () => {
    const res = await request(app.getHttpServer()).get('/profile').set(auth());
    expect(res.status).toBe(200);
    expect(res.body.agencyName).toBe('Studio');
    expect(Array.isArray(res.body.services)).toBe(true);
    expect(res.body.portfolioLinks).toEqual([]);
  });

  it('updates rich brand + credibility fields', async () => {
    const res = await request(app.getHttpServer()).patch('/profile').set(auth()).send({
      logoUrl: 'https://cdn.example.com/logo.png',
      website: 'https://studio.example.com',
      contactInfo: 'hello@studio.example.com',
      brandColor: '#4F46E5',
      portfolioLinks: ['https://dribbble.com/studio', 'https://behance.net/studio'],
      caseStudies: [{ title: 'Acme rebrand', summary: 'Lifted conversion 30%' }],
      testimonials: [{ author: 'Jane', quote: 'Best agency ever', company: 'Acme' }],
    });
    expect(res.status).toBe(200);
    expect(res.body.logoUrl).toBe('https://cdn.example.com/logo.png');
    expect(res.body.portfolioLinks).toHaveLength(2);
    expect(res.body.caseStudies[0].title).toBe('Acme rebrand');
    expect(res.body.testimonials[0].author).toBe('Jane');
  });

  it('rejects an invalid brand color', async () => {
    const res = await request(app.getHttpServer()).patch('/profile').set(auth()).send({ brandColor: 'not-a-color' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION');
  });
});
