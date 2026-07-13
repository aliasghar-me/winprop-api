import { Module } from '@nestjs/common';
import { MemoryService } from './memory.service';
import { MemoryController } from './memory.controller';

// PrismaModule + CryptoModule are @Global, so their services are injectable here
// without importing them.
@Module({ providers: [MemoryService], controllers: [MemoryController], exports: [MemoryService] })
export class MemoryModule {}
