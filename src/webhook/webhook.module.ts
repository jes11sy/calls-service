import { Module } from '@nestjs/common';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';
import { CallsService } from '../calls/calls.service';
import { MangoModule } from '../mango/mango.module';
import { S3Module } from '../s3/s3.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { AuditLoggerService } from '../common/services/audit-logger.service';
import { QueueModule } from '../queue/queue.module';

@Module({
  imports: [MangoModule, S3Module, RealtimeModule, QueueModule],
  controllers: [WebhookController],
  providers: [WebhookService, CallsService, AuditLoggerService],
})
export class WebhookModule {}



