import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import axios from 'axios';

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(private prisma: PrismaService) {}

  async processMangoWebhook(payload: any) {
    // Парсим данные от Mango Office
    const {
      call_id,
      from,
      to,
      entry_id,
      command_id,
      result,
      disconnect_reason,
      seq,
      timestamp,
      create_time,
      answer_time,
      end_time,
    } = payload;

    // Определяем направление звонка
    const direction = command_id === 'USER_CALL' ? 'outbound' : 'inbound';

    // Определяем статус
    let status = 'missed';
    if (result === 200) {
      status = 'answered';
    } else if (result === 486) {
      status = 'busy';
    } else if (result === 408 || result === 480) {
      status = 'missed';
    } else {
      status = 'failed';
    }

    // Вычисляем длительность
    let duration = 0;
    if (answer_time && end_time) {
      duration = Math.floor((end_time - answer_time) / 1000);
    }

    // Сохраняем или обновляем звонок
    const existingCall = await this.prisma.call.findUnique({
      where: { callId: call_id },
    });

    let call;
    if (existingCall) {
      // Обновляем существующий звонок
      call = await this.prisma.call.update({
        where: { callId: call_id },
        data: {
          status,
          duration,
          phoneOperator: to,
          callDate: new Date(create_time || timestamp * 1000),
        },
      });
    } else {
      // Создаем новый звонок
      call = await this.prisma.call.create({
        data: {
          callId: call_id,
          phoneClient: from,
          phoneOperator: to,
          direction,
          callDate: new Date(create_time || timestamp * 1000),
          duration,
          status,
        },
      });
    }

    this.logger.log(`Call ${call_id} processed: ${status}, duration: ${duration}s`);

    return {
      success: true,
      message: 'Webhook processed',
      data: { callId: call_id, status },
    };
  }

  async processMangoRecording(payload: any) {
    const { call_id, recording_link } = payload;

    if (!call_id || !recording_link) {
      return { success: false, message: 'Missing required fields' };
    }

    // Обновляем запись звонка с ссылкой на запись
    const call = await this.prisma.call.updateMany({
      where: { callId: call_id },
      data: { recordUrl: recording_link },
    });

    this.logger.log(`Recording link saved for call ${call_id}: ${recording_link}`);

    return {
      success: true,
      message: 'Recording link saved',
      data: { callId: call_id },
    };
  }

  // Метод для скачивания записи звонка
  async downloadRecording(callId: string) {
    const call = await this.prisma.call.findUnique({
      where: { callId },
    });

    if (!call || !call.recordUrl) {
      throw new Error('Recording not found');
    }

    try {
      // Скачиваем файл
      const response = await axios.get(call.recordUrl, {
        responseType: 'stream',
      });

      return response.data;
    } catch (error) {
      this.logger.error(`Error downloading recording: ${error.message}`);
      throw error;
    }
  }
}

