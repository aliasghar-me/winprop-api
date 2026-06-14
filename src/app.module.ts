import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { HealthController } from './health/health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { CryptoModule } from './common/crypto/crypto.module';

@Module({
  imports: [PrismaModule, CryptoModule],
  controllers: [AppController, HealthController],
  providers: [AppService],
})
export class AppModule {}
