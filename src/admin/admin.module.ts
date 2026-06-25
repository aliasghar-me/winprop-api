import { Module } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { SuperAdminService } from './super-admin.service';
import { SuperAdminGuard } from '../auth/guards/super-admin.guard';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule], // for JwtModule (super-admin token sign/verify)
  providers: [AdminService, SuperAdminService, SuperAdminGuard],
  controllers: [AdminController],
})
export class AdminModule {}
