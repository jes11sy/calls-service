import { Controller, Post, Body, HttpCode, HttpStatus, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { WebhookService } from './webhook.service';

@ApiTags('webhook')
@Controller('webhook')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(private webhookService: WebhookService) {}

  @Post('mango')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mango Office webhook endpoint' })
  async mangoWebhook(@Body() payload: any) {
    this.logger.log(`Received Mango webhook: ${JSON.stringify(payload)}`);
    
    try {
      const result = await this.webhookService.processMangoWebhook(payload);
      return result;
    } catch (error) {
      this.logger.error(`Error processing Mango webhook: ${error.message}`, error.stack);
      // Возвращаем 200 даже при ошибке, чтобы Mango не ретраил
      return { success: false, message: error.message };
    }
  }

  @Post('mango/recording')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mango Office recording webhook' })
  async mangoRecordingWebhook(@Body() payload: any) {
    this.logger.log(`Received Mango recording webhook: ${JSON.stringify(payload)}`);
    
    try {
      const result = await this.webhookService.processMangoRecording(payload);
      return result;
    } catch (error) {
      this.logger.error(`Error processing Mango recording: ${error.message}`, error.stack);
      return { success: false, message: error.message };
    }
  }
}













