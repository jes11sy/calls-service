import { Module } from '@nestjs/common';
import { CallsController } from './calls.controller';
import { CallsService } from './calls.service';
import { AuditLoggerService } from '../common/services/audit-logger.service';

@Module({
  controllers: [CallsController],
  providers: [CallsService, AuditLoggerService],
  exports: [CallsService],
})
export class CallsModule {}





















