import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { writeFileSync } from 'fs';
import { AppModule } from '../src/app.module';

async function main() {
  const app = await NestFactory.create(AppModule, { logger: false });
  const doc = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('WinProp API').setVersion('1').addBearerAuth().build());
  writeFileSync('openapi.json', JSON.stringify(doc, null, 2));
  await app.close();
  console.log('wrote openapi.json');
}
main();
