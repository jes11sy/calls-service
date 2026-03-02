import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface AuditLogEntry {
  action: string;
  userId?: number;
  userLogin?: string;
  userRole?: string;
  resourceType?: string;
  resourceId?: number;
  metadata?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class AuditLoggerService {
  private readonly logger = new Logger('AuditLogger');

  constructor(private readonly prisma: PrismaService) {}

  async log(entry: AuditLogEntry): Promise<void> {
    this.logger.log(JSON.stringify({ timestamp: new Date().toISOString(), ...entry }));

    try {
      await this.prisma.auditCalls.create({
        data: {
          eventType: entry.action,
          userId: entry.userId ?? null,
          role: entry.userRole ?? null,
          login: entry.userLogin ?? null,
          ip: entry.ipAddress ?? '0.0.0.0',
          userAgent: entry.userAgent ?? 'system',
          success: true,
          metadata: entry.metadata ? JSON.parse(JSON.stringify(entry.metadata)) : undefined,
        },
      });
    } catch (error) {
      this.logger.error(`Failed to write audit log to DB: ${error.message}`);
    }
  }

  async logCallCreated(callId: number, userId: number, userLogin: string, metadata?: Record<string, any>) {
    await this.log({
      action: 'CALL_CREATED',
      userId,
      userLogin,
      resourceType: 'call',
      resourceId: callId,
      metadata: { ...metadata, callId },
    });
  }

  async logCallUpdated(callId: number, userId?: number, userLogin?: string, metadata?: Record<string, any>) {
    await this.log({
      action: 'CALL_UPDATED',
      userId,
      userLogin,
      resourceType: 'call',
      resourceId: callId,
      metadata: { ...metadata, callId },
    });
  }

  async logRecordingAccessed(callId: number, userId: number, userLogin: string, ipAddress?: string) {
    await this.log({
      action: 'RECORDING_ACCESSED',
      userId,
      userLogin,
      resourceType: 'call',
      resourceId: callId,
      ipAddress,
    });
  }

  async logWebhookReceived(callId: string, source: string, metadata?: Record<string, any>) {
    await this.log({
      action: 'WEBHOOK_RECEIVED',
      resourceType: 'webhook',
      metadata: { callId, source, ...metadata },
    });
  }
}
