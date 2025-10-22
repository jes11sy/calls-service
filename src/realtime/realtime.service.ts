import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);
  private readonly realtimeUrl: string;
  private readonly webhookToken: string;

  constructor() {
    this.realtimeUrl = process.env.REALTIME_SERVICE_URL || 'http://realtime-service:5009';
    this.webhookToken = process.env.WEBHOOK_TOKEN || '';

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
      await axios.post(
        `${this.realtimeUrl}/api/v1/broadcast/call-new`,
        {
          token: this.webhookToken,
          call: {
            id: call.id,
            callId: call.callId,
            phoneClient: call.phoneClient,
            phoneOperator: call.phoneOperator,
            direction: call.direction,
            callDate: call.callDate,
            status: call.status,
            operatorId: call.operatorId,
          },
          rooms,
        },
        { timeout: 5000 }
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
      await axios.post(
        `${this.realtimeUrl}/api/v1/broadcast/call-updated`,
        {
          token: this.webhookToken,
          call: {
            id: call.id,
            callId: call.callId,
            phoneClient: call.phoneClient,
            status: call.status,
            duration: call.duration,
            recordUrl: call.recordUrl,
            recordFile: call.recordFile,
            operatorId: call.operatorId,
          },
          rooms,
        },
        { timeout: 5000 }
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
      await axios.post(
        `${this.realtimeUrl}/api/v1/broadcast/call-ended`,
        {
          token: this.webhookToken,
          call: {
            id: call.id,
            callId: call.callId,
            phoneClient: call.phoneClient,
            status: call.status,
            duration: call.duration,
            operatorId: call.operatorId,
          },
          rooms,
        },
        { timeout: 5000 }
      );

      this.logger.log(`✅ Broadcasted call ended: ${call.id}`);
    } catch (error) {
      this.logger.error(`❌ Failed to broadcast call ended: ${error.message}`);
    }
  }

  isConfigured(): boolean {
    return !!this.webhookToken;
  }
}

