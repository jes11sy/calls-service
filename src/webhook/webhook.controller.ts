import { Controller, Post, Body, HttpCode, HttpStatus, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { WebhookService } from './webhook.service';
import { MangoWebhookDto, MangoRecordingWebhookDto } from './dto/mango-webhook.dto';

@ApiTags('webhook')
@Controller('webhook')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(private webhookService: WebhookService) {}

  @Post('mango')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mango Office webhook endpoint' })
  async mangoWebhook(@Body() payload: MangoWebhookDto) {
    this.logger.log(`Received Mango webhook: ${payload.call_id} - ${payload.call_state}`);
    
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
  async mangoRecordingWebhook(@Body() payload: MangoRecordingWebhookDto) {
    this.logger.log(`Received Mango recording webhook: ${payload.recording_id}`);
    
    try {
      const result = await this.webhookService.processMangoRecording(payload);
      return result;
    } catch (error) {
      this.logger.error(`Error processing Mango recording: ${error.message}`, error.stack);
      return { success: false, message: error.message };
    }
  }

  // Новые эндпоинты для Mango Office (новый формат URL)
  @Post('events/call')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mango Office call events webhook' })
  async mangoCallEvent(@Body() payload: any) {
    this.logger.log(`Received Mango call event: ${JSON.stringify(payload)}`);
    
    try {
      // Используем тот же обработчик что и для /mango
      const result = await this.webhookService.processMangoWebhook(payload);
      return result;
    } catch (error) {
      this.logger.error(`Error processing Mango call event: ${error.message}`, error.stack);
      return { success: false, message: error.message };
    }
  }

  @Post('events/recording')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mango Office recording events webhook' })
  async mangoRecordingEvent(@Body() payload: any) {
    this.logger.log(`Received Mango recording event: ${JSON.stringify(payload)}`);
    
    try {
      const result = await this.webhookService.processMangoRecording(payload);
      return result;
    } catch (error) {
      this.logger.error(`Error processing Mango recording event: ${error.message}`, error.stack);
      return { success: false, message: error.message };
    }
  }

  @Post('events/summary')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mango Office call summary webhook' })
  async mangoSummaryEvent(@Body() payload: any) {
    this.logger.log(`Received Mango summary event: ${JSON.stringify(payload)}`);
    
    try {
      // Для summary пока просто логируем и возвращаем успех
      return { success: true, message: 'Summary received' };
    } catch (error) {
      this.logger.error(`Error processing Mango summary: ${error.message}`, error.stack);
      return { success: false, message: error.message };
    }
  }

  @Post('events/record/added')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mango Office record added webhook' })
  async mangoRecordAddedEvent(@Body() payload: any) {
    this.logger.log(`Received Mango record added event: ${JSON.stringify(payload)}`);
    
    try {
      const result = await this.webhookService.processMangoRecording(payload);
      return result;
    } catch (error) {
      this.logger.error(`Error processing Mango record added: ${error.message}`, error.stack);
      return { success: false, message: error.message };
    }
  }
}





















