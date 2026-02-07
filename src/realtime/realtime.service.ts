import { Injectable, Logger } from '@nestjs/common';
import { createRetryableAxiosInstance } from '../common/utils/axios-config';

@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);
  private readonly realtimeUrl: string;
  private readonly webhookToken: string;
  private readonly axiosInstance;

  constructor() {
    this.realtimeUrl = process.env.REALTIME_SERVICE_URL || 'http://172.18.0.9:5009';
    this.webhookToken = process.env.WEBHOOK_TOKEN || '';
    this.axiosInstance = createRetryableAxiosInstance(5000, 3);

    if (!this.webhookToken) {
      this.logger.warn('⚠️ WEBHOOK_TOKEN not configured - realtime broadcasts disabled');
    }
  }

  async broadcastNewCall(call: any, rooms: string[] = ['operators']): Promise<void> {
    if (!this.webhookToken) {
      this.logger.warn('Realtime broadcast skipped - no webhook token');
      return;
    }

    try {
      await this.axiosInstance.post(
        `${this.realtimeUrl}/api/v1/broadcast/call-new`,
        {
          token: this.webhookToken,
          call: {
            id: call.id,
            rk: call.rk,
            city: call.city,
            callDirection: call.callDirection,
            avitoName: call.avitoName,
            callId: call.callId,
            phoneClient: call.phoneClient,
            phoneAts: call.phoneAts,
            createdAt: call.createdAt,
            status: call.status,
            operatorId: call.operatorId,
            duration: call.duration,
            operator: call.operator, // Вложенный объект оператора
          },
          rooms,
        }
      );

      this.logger.log(`✅ Broadcasted new call: ${call.id}`);
    } catch (error) {
      this.logger.error(`❌ Failed to broadcast new call: ${error.message}`);
    }
  }

  async broadcastCallUpdated(call: any, rooms: string[] = ['operators']): Promise<void> {
    if (!this.webhookToken) {
      return;
    }

    try {
      await this.axiosInstance.post(
        `${this.realtimeUrl}/api/v1/broadcast/call-updated`,
        {
          token: this.webhookToken,
          call: {
            id: call.id,
            callId: call.callId,
            callDirection: call.callDirection,
            phoneClient: call.phoneClient,
            status: call.status,
            duration: call.duration,
            recordingPath: call.recordingPath,
            operatorId: call.operatorId,
          },
          rooms,
        }
      );

      this.logger.log(`✅ Broadcasted call update: ${call.id}`);
    } catch (error) {
      this.logger.error(`❌ Failed to broadcast call update: ${error.message}`);
    }
  }

  async broadcastCallEnded(call: any, rooms: string[] = ['operators']): Promise<void> {
    if (!this.webhookToken) {
      return;
    }

    try {
      await this.axiosInstance.post(
        `${this.realtimeUrl}/api/v1/broadcast/call-ended`,
        {
          token: this.webhookToken,
          call: {
            id: call.id,
            callId: call.callId,
            callDirection: call.callDirection,
            phoneClient: call.phoneClient,
            status: call.status,
            duration: call.duration,
            operatorId: call.operatorId,
          },
          rooms,
        }
      );

      this.logger.log(`✅ Broadcasted call ended: ${call.id}`);
    } catch (error) {
      this.logger.error(`❌ Failed to broadcast call ended: ${error.message}`);
    }
  }

  /**
   * Отправить UI-уведомление оператору о входящем звонке
   */
  async sendCallNotificationToOperator(
    operatorId: number,
    callId: number,
    phoneClient: string,
    callDirection: 'inbound' | 'outbound' | 'callback',
    city?: string,
    avitoName?: string,
  ): Promise<void> {
    try {
      await this.axiosInstance.post(
        `${this.realtimeUrl}/api/v1/notifications/internal/operator/call`,
        {
          operatorId,
          callId,
          phoneClient,
          callDirection,
          city,
          avitoName,
        },
        { timeout: 3000 }
      );

      this.logger.debug(`✅ UI call notification sent to operator ${operatorId}`);
    } catch (error) {
      this.logger.warn(`⚠️ Failed to send UI call notification: ${error.message}`);
    }
  }

  isConfigured(): boolean {
    return !!this.webhookToken;
  }
}

