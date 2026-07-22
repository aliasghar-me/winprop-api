// Load .env for local development BEFORE anything reads process.env. In production
// the platform injects real env vars; dotenv does not override already-set vars, and
// .env is gitignored — so this is a no-op there and safe to keep unconditionally.
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { I18nValidationPipe } from 'nestjs-i18n';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { json } from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { validateEnv } from './config/validate-env';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter';
import { initSentry } from './common/observability/sentry';

async function bootstrap() {
  validateEnv(); // fail closed on missing/weak/default secrets before anything else
  initSentry(); // error tracking (no-op unless SENTRY_DSN is set)
  const app = await NestFactory.create(AppModule, { bodyParser: false, bufferLogs: true });
  app.useLogger(app.get(Logger)); // route Nest logs through pino (structured + correlation id)
  // Behind Caddy/Traefik: trust one proxy hop so req.ip is the real client (rate limiting).
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  app.use(helmet()); // security headers (CSP/HSTS/XFO/no-sniff/referrer-policy)
  // Raw body ONLY for the Stripe webhook (added in a later task); JSON everywhere else.
  app.use('/billing/webhook', json({ verify: (req: any, _res, buf) => { req.rawBody = buf; } }));
  app.use(json({ limit: '512kb' })); // cap payload size (security #3)
  app.use(cookieParser());
  // Strict allow-list (validateEnv guarantees WEB_ORIGIN is set) — never reflect arbitrary origins.
  app.enableCors({ origin: process.env.WEB_ORIGIN!.split(','), credentials: true });
  // I18nValidationPipe localizes class-validator messages (H8) using the request
  // language; the constraint strings it throws are already translated. AllExceptionsFilter
  // unwraps the resulting I18nValidationException into our standard error envelope.
  app.useGlobalPipes(new I18nValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  // Don't expose the API surface (routes/DTOs) publicly in production (security #6).
  if (process.env.NODE_ENV !== 'production') {
    const doc = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('WinProp API').setVersion('1').addBearerAuth().build());
    SwaggerModule.setup('docs', app, doc);
  }
  await app.listen(process.env.PORT ?? 3001);
}
bootstrap();
