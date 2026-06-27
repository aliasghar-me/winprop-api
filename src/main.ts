import { NestFactory } from '@nestjs/core';
import { I18nValidationPipe } from 'nestjs-i18n';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { json } from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { validateEnv } from './config/validate-env';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter';

async function bootstrap() {
  validateEnv(); // fail closed on missing/weak/default secrets before anything else
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  // Behind Caddy/Traefik: trust one proxy hop so req.ip is the real client (rate limiting).
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  app.use(helmet()); // security headers (CSP/HSTS/XFO/no-sniff/referrer-policy)
  // Raw body ONLY for the Stripe webhook (added in a later task); JSON everywhere else.
  app.use('/billing/webhook', json({ verify: (req: any, _res, buf) => { req.rawBody = buf; } }));
  app.use(json());
  app.use(cookieParser());
  // Strict allow-list (validateEnv guarantees WEB_ORIGIN is set) — never reflect arbitrary origins.
  app.enableCors({ origin: process.env.WEB_ORIGIN!.split(','), credentials: true });
  // I18nValidationPipe localizes class-validator messages (H8) using the request
  // language; the constraint strings it throws are already translated. AllExceptionsFilter
  // unwraps the resulting I18nValidationException into our standard error envelope.
  app.useGlobalPipes(new I18nValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  const doc = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('WinProp API').setVersion('1').addBearerAuth().build());
  SwaggerModule.setup('docs', app, doc);
  await app.listen(process.env.PORT ?? 3001);
}
bootstrap();
