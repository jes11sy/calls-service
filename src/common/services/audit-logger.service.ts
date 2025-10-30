import { Injectable, Logger } from '@nestjs/common';

export interface AuditLogEntry {
  action: string;
  userId?: number;
  userLogin?: string;
  resourceType?: string;
  resourceId?: number;
  metadata?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
}

@Injectable()
export class AuditLoggerService {
  private readonly logger = new Logger('AuditLogger');

  log(entry: AuditLogEntry) {
    const timestamp = new Date().toISOString();
    const logMessage = JSON.stringify({
      timestamp,
      ...entry,
    });

    this.logger.log(logMessage);

    // TODO: Store in database for long-term audit trail
    // await this.prisma.auditLog.create({ data: { ...entry, timestamp } });
  }

  logCallCreated(callId: number, userId: number, userLogin: string, metadata?: Record<string, any>) {
    this.log({
      action: 'CALL_CREATED',
      userId,
      userLogin,
      resourceType: 'call',
      resourceId: callId,
      metadata,
    });
  }

  logCallUpdated(callId: number, userId?: number, userLogin?: string, metadata?: Record<string, any>) {
    this.log({
      action: 'CALL_UPDATED',
      userId,
      userLogin,
      resourceType: 'call',
      resourceId: callId,
      metadata,
    });
  }

  logRecordingAccessed(callId: number, userId: number, userLogin: string, ipAddress?: string) {
    this.log({
      action: 'RECORDING_ACCESSED',
      userId,
      userLogin,
      resourceType: 'call',
      resourceId: callId,
      ipAddress,
    });
  }

  logWebhookReceived(callId: string, source: string, metadata?: Record<string, any>) {
    this.log({
      action: 'WEBHOOK_RECEIVED',
      resourceType: 'webhook',
      metadata: { callId, source, ...metadata },
    });
  }
}

