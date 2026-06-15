import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from '../src/app.module';

describe('OpenAPI', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    const doc = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('WinProp').setVersion('1').build());
    SwaggerModule.setup('docs', app, doc);
    await app.init();
  });
  afterAll(async () => { await app.close(); });
  it('serves the OpenAPI json', async () => {
    const res = await request(app.getHttpServer()).get('/docs-json');
    expect(res.status).toBe(200);
    expect(res.body.paths['/jobs']).toBeDefined();
  });
});
