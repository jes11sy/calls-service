import { Module } from '@nestjs/common';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';
import { CallsService } from '../calls/calls.service';

@Module({
  controllers: [WebhookController],
  providers: [WebhookService, CallsService],
})
export class WebhookModule {}

