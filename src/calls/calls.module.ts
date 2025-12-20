import { Module } from '@nestjs/common';
import { CallsController } from './calls.controller';
import { CallsService } from './calls.service';
import { AuditLoggerService } from '../common/services/audit-logger.service';
import { MangoModule } from '../mango/mango.module';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [MangoModule, RealtimeModule],
  controllers: [CallsController],
  providers: [CallsService, AuditLoggerService],
  exports: [CallsService],
})
export class CallsModule {}





















