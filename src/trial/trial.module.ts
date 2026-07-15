import { Module } from '@nestjs/common';
import { TrialService } from './trial.service';

// CryptoService is provided by the @Global() CryptoModule; PrismaService by the
// @Global() PrismaModule — so this module only needs to declare TrialService.
@Module({
  providers: [TrialService],
  exports: [TrialService],
})
export class TrialModule {}
