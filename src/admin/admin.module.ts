import { Module } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { SuperAdminGuard } from '../auth/guards/super-admin.guard';
@Module({ providers: [AdminService, SuperAdminGuard], controllers: [AdminController] })
export class AdminModule {}
