import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import * as crypto from 'crypto';

@Injectable()
export class MangoService {
  private readonly logger = new Logger(MangoService.name);
  private readonly apiKey: string;
  private readonly apiSalt: string;
  private readonly apiUrl: string;

  constructor() {
    this.apiKey = process.env.MANGO_OFFICE_API_KEY || process.env.MANGO_API_KEY || '';
    this.apiSalt = process.env.MANGO_OFFICE_API_SALT || process.env.MANGO_API_SALT || '';
    this.apiUrl = process.env.MANGO_API_URL || 'https://app.mango-office.ru/vpbx';

    if (!this.apiKey || !this.apiSalt) {
      this.logger.warn('⚠️ Mango Office API credentials not configured');
    } else {
      this.logger.log('✅ Mango Office API configured');
    }
  }

  async downloadRecording(recordingId: string): Promise<Buffer> {
    if (!this.apiKey || !this.apiSalt) {
      throw new Error('Mango Office API credentials not configured');
    }

    try {
      // Генерируем подпись для POST запроса
      const json = JSON.stringify({
        recording_id: recordingId,
        action: 'play',
      });

      const sign = crypto
        .createHash('sha256')
        .update(`${this.apiKey}${json}${this.apiSalt}`)
        .digest('hex');

      this.logger.log(`📥 Downloading recording from Mango: ${recordingId}`);

      // Делаем POST запрос к Mango API
      const response = await axios.post(
        `${this.apiUrl}/queries/recording/post`,
        new URLSearchParams({
          vpbx_api_key: this.apiKey,
          sign: sign,
          json: json,
        }),
        {
          maxRedirects: 5,
          responseType: 'arraybuffer',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          timeout: 60000,
        }
      );

      const buffer = Buffer.from(response.data);
      this.logger.log(`✅ Recording downloaded: ${buffer.length} bytes`);

      return buffer;
    } catch (error) {
      this.logger.error(`❌ Failed to download recording: ${error.message}`);
      throw error;
    }
  }

  determineCallStatus(webhookData: any): 'answered' | 'missed' | 'busy' | 'no_answer' {
    // Проверяем disconnect_reason
    if (webhookData.disconnect_reason) {
      switch (webhookData.disconnect_reason) {
        case 1100: // Нормальное завершение
        case 1120: // Нормальное завершение
          return 'answered';
        case 1101: // Занято
          return 'busy';
        case 1102: // Нет ответа
          return 'no_answer';
        default:
          return 'missed';
      }
    }

    // Если есть answer_time - значит ответили
    if (webhookData.answer_time) {
      return 'answered';
    }

    // Проверяем entry_result
    if (webhookData.entry_result === 'success') {
      return 'answered';
    }

    // По умолчанию - пропущенный
    return 'missed';
  }

  calculateDuration(webhookData: any): number {
    if (webhookData.duration) {
      return parseInt(webhookData.duration);
    }

    if (webhookData.answer_time && webhookData.end_time) {
      return Math.floor((webhookData.end_time - webhookData.answer_time) / 1000);
    }

    if (webhookData.create_time && webhookData.end_time) {
      return Math.floor((webhookData.end_time - webhookData.create_time) / 1000);
    }

    return 0;
  }

  extractSipUsername(phoneNumber: string): string {
    // Извлекаем имя пользователя из SIP-адреса
    let sipUsername = phoneNumber;
    if (phoneNumber && phoneNumber.startsWith('sip:')) {
      // Извлекаем имя пользователя из sip:username@domain
      const match = phoneNumber.match(/sip:([^@]+)@/);
      if (match) {
        sipUsername = match[1];
      }
    }
    return sipUsername;
  }

  isConfigured(): boolean {
    return !!(this.apiKey && this.apiSalt);
  }
}

