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

  private getCallSource(call: any): string | null {
    return call.source ?? call.appeal?.sourceType ?? null;
  }

  private getCallOrderId(call: any): number | null {
    return call.orderId ?? call.appeal?.orderId ?? null;
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
            rkId: call.rkId,
            rkName: call.rk?.name ?? null,
            cityId: call.cityId,
            cityName: call.city?.name ?? null,
            source: this.getCallSource(call),
            callDirection: call.callDirection,
            callId: call.callId,
            phoneClient: call.phoneClient,
            phoneAts: call.phoneAts,
            createdAt: call.createdAt,
            status: call.status,
            operatorId: call.operatorId,
            duration: call.duration,
            operator: call.operator,
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
            phoneAts: call.phoneAts,
            status: call.status,
            duration: call.duration,
            recordingPath: call.recordingPath,
            operatorId: call.operatorId,
            orderId: this.getCallOrderId(call),
            cityId: call.cityId ?? null,
            rkId: call.rkId ?? null,
            cityName: call.city?.name ?? null,
            rkName: call.rk?.name ?? null,
            source: this.getCallSource(call),
            operator: call.operator ? { id: call.operator.id, name: call.operator.name } : null,
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
            phoneAts: call.phoneAts,
            status: call.status,
            duration: call.duration,
            operatorId: call.operatorId,
            orderId: this.getCallOrderId(call),
            cityId: call.cityId ?? null,
            rkId: call.rkId ?? null,
            cityName: call.city?.name ?? null,
            rkName: call.rk?.name ?? null,
            source: this.getCallSource(call),
            operator: call.operator ? { id: call.operator.id, name: call.operator.name } : null,
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
   * Отправить UI-уведомление оператору о звонке
   * @param callType - тип уведомления: 'call_incoming' или 'call_missed'
   */
  async sendCallNotificationToOperator(
    operatorId: number,
    callId: number,
    phoneClient: string,
    callType: 'call_incoming' | 'call_missed',
    cityId?: number,
    rkName?: string,
    source?: string | null,
  ): Promise<void> {
    try {
      await this.axiosInstance.post(
        `${this.realtimeUrl}/api/v1/notifications/internal/operator/call`,
        {
          operatorId,
          callId,
          phoneClient,
          callType,
          cityId,
          rkName,
          source: source ?? undefined,
        },
        { timeout: 3000 }
      );

      this.logger.debug(`✅ UI ${callType} notification sent to operator ${operatorId}`);
    } catch (error) {
      this.logger.warn(`⚠️ Failed to send UI call notification: ${error.message}`);
    }
  }

  /**
   * Отправить UI-уведомление всем операторам о звонке (когда оператор не определён)
   */
  async broadcastCallNotificationToAllOperators(
    callId: number,
    phoneClient: string,
    callType: 'call_incoming' | 'call_missed',
    cityId?: number,
    rkName?: string,
    source?: string | null,
  ): Promise<void> {
    try {
      await this.axiosInstance.post(
        `${this.realtimeUrl}/api/v1/notifications/internal/operators/call`,
        {
          callId,
          phoneClient,
          callType,
          cityId,
          rkName,
          source: source ?? undefined,
        },
        { timeout: 3000 }
      );

      this.logger.debug(`✅ UI ${callType} notification broadcasted to all operators`);
    } catch (error) {
      this.logger.warn(`⚠️ Failed to broadcast UI call notification: ${error.message}`);
    }
  }

  isConfigured(): boolean {
    return !!this.webhookToken;
  }
}

