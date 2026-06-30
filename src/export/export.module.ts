import { Module } from '@nestjs/common';
import { ExportService } from './export.service';
import { ExportController } from './export.controller';
import { JobsModule } from '../jobs/jobs.module';

@Module({ imports: [JobsModule], providers: [ExportService], controllers: [ExportController] })
export class ExportModule {}
