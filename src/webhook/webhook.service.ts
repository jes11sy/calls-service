import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { MangoService } from '../mango/mango.service';
import { RealtimeService } from '../realtime/realtime.service';
import { RECORDING_QUEUE } from '../queue/constants';
import { RecordingJobData } from '../queue/recording.processor';

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  // Fallback cityId и rkId если не удалось определить из phone/operator
  private readonly DEFAULT_CITY_ID = 1;
  private readonly DEFAULT_RK_ID = 1;
  private readonly SYSTEM_OPERATOR_ID = 1;
  private cachedNewStatusId: number | null = null;

  constructor(
    private prisma: PrismaService,
    private mangoService: MangoService,
    private realtimeService: RealtimeService,
    @InjectQueue(RECORDING_QUEUE) private recordingQueue: Queue<RecordingJobData>,
  ) {}

  async processMangoWebhook(payload: any) {
    try {
      this.logger.log(`Processing Mango webhook: ${JSON.stringify(payload)}`);

      const { call_id, call_state, from, to, location, command_id } = payload;

      if (location === 'ivr') {
        this.logger.log(`Ignoring IVR call ${call_id}`);
        return { success: true, message: 'IVR call ignored' };
      }

      const isCallback = command_id && command_id.startsWith('callback_');
      const isOutbound = this.isOutboundCall(from, to);
      const callDirection = isCallback ? 'callback' : (isOutbound ? 'outbound' : 'inbound');

      if (isCallback && to?.extension) {
        this.logger.log(`Ignoring callback first leg: ${call_id}`);
        return { success: true, message: 'Callback first leg ignored' };
      }

      if (callDirection === 'inbound') {
        const phoneClient = from?.number || from;
        const phoneAts = to?.line_number || from?.line_number;

        if (phoneClient && phoneAts) {
          const thirtySecondsAgo = new Date(Date.now() - 30000);
          const recentCallback = await this.prisma.call.findFirst({
            where: { phoneClient, phoneAts, callDirection: 'callback', createdAt: { gte: thirtySecondsAgo } },
            orderBy: { createdAt: 'desc' },
          });
          if (recentCallback) {
            return { success: true, message: 'Post-callback followup ignored' };
          }
        }
      }

      if (call_state === 'Appeared') return this.handleCallAppeared(payload, callDirection);
      if (call_state === 'Connected') return this.handleCallConnected(payload, callDirection);
      if (call_state === 'Disconnected') return this.handleCallDisconnected(payload, callDirection);

      return this.handleLegacyFormat(payload, callDirection);
    } catch (error) {
      this.logger.error(`Error processing Mango webhook: ${error.message}`, error.stack);
      return { success: false, message: error.message };
    }
  }

  async processMangoSummary(summaryData: any) {
    try {
      this.logger.log(`Processing Mango summary: ${JSON.stringify(summaryData)}`);

      const { entry_id, call_direction, from, to, line_number, create_time, talk_time, end_time, entry_result, command_id } = summaryData;

      if (!entry_id) {
        this.logger.warn('Entry ID is missing in summary event');
        return { success: true, message: 'Entry ID missing' };
      }

      const existingCallForDirection = await this.prisma.call.findFirst({
        where: {
          OR: [
            { callId: entry_id },
            { mangoData: { path: ['entry_id'], equals: entry_id } },
          ],
        },
      });

      let isCallback = command_id && command_id.startsWith('callback_');
      if (!isCallback && existingCallForDirection?.callDirection === 'callback') {
        isCallback = true;
      }

      const isOutbound = call_direction === 2;
      const callDirectionType = isCallback ? 'callback' : (isOutbound ? 'outbound' : 'inbound');

      if (callDirectionType === 'inbound' && !existingCallForDirection) {
        const phoneClient = from?.number || from;
        const phoneAts = line_number || to?.line_number || from?.line_number;
        if (phoneClient && phoneAts) {
          const thirtySecondsAgo = new Date(Date.now() - 30000);
          const recentCallback = await this.prisma.call.findFirst({
            where: { phoneClient, phoneAts, callDirection: 'callback', createdAt: { gte: thirtySecondsAgo } },
            orderBy: { createdAt: 'desc' },
          });
          if (recentCallback) return { success: true, message: 'Post-callback followup ignored' };
        }
      }

      let status = 'missed';
      let duration = 0;
      if (talk_time && end_time && talk_time > 0) {
        duration = end_time - talk_time;
        status = 'answered';
      } else if (entry_result === 1) {
        status = 'answered';
      }
      if (duration > 0) status = 'answered';

      const phoneAts = line_number || to?.line_number || from?.line_number;
      const phoneClient = isOutbound ? (to?.number || to) : (from?.number || from);

      let operator: any;
      let phone: any;
      let masterId: number | null = null;

      if (isCallback) {
        [phone, operator] = await Promise.all([
          phoneAts ? this.prisma.phone.findUnique({ where: { number: phoneAts }, include: { city: true, rk: true } }) : null,
          this.prisma.operator.findUnique({ where: { id: this.SYSTEM_OPERATOR_ID } }),
        ]);

        if (existingCallForDirection?.masterId) {
          masterId = existingCallForDirection.masterId;
        } else if (command_id) {
          masterId = await this.getMasterIdFromCommandId(command_id);
        } else {
          const savedCommandId = (existingCallForDirection?.mangoData as any)?.command_id;
          if (savedCommandId) masterId = await this.getMasterIdFromCommandId(savedCommandId);
        }
      } else {
        const operatorSipSource = isOutbound ? (from?.number || from) : (to?.number || to);
        const sipUsername = this.mangoService.extractSipUsername(operatorSipSource);

        [phone, operator] = await Promise.all([
          phoneAts ? this.prisma.phone.findUnique({ where: { number: phoneAts }, include: { city: true, rk: true } }) : null,
          this.findOperatorBySip(sipUsername),
        ]);

        if (!operator) {
          this.logger.warn(`Operator not found for SIP: ${sipUsername}`);
          return { success: true, message: 'Operator not found' };
        }
      }

      const cityId = phone?.cityId || this.DEFAULT_CITY_ID;
      const rkId = phone?.rkId || this.DEFAULT_RK_ID;

      let existingCall = existingCallForDirection;
      if (!existingCall) {
        existingCall = await this.prisma.call.findFirst({
          where: {
            phoneClient,
            phoneAts,
            operatorId: operator.id,
            createdAt: {
              gte: new Date((create_time - 10) * 1000),
              lte: new Date((create_time + 10) * 1000),
            },
          },
          orderBy: { createdAt: 'desc' },
        });
      }

      const finalStatus = (existingCall?.status === 'answered' && status !== 'answered') ? 'answered' : status;
      const finalDuration = (existingCall?.status === 'answered' && duration === 0 && (existingCall.duration ?? 0) > 0) ? existingCall.duration : duration;

      let call: any;
      let isNewCall = false;

      if (existingCall) {
        call = await this.prisma.call.update({
          where: { id: existingCall.id },
          data: {
            callId: entry_id,
            callDirection: callDirectionType,
            status: finalStatus,
            duration: finalDuration,
            phoneClient,
            phoneAts,
            mangoData: summaryData,
            ...(masterId && { masterId }),
          },
          include: { operator: { select: { id: true, name: true } }, city: true, rk: true, appeals: { take: 1, orderBy: { id: 'desc' }, select: { sourceType: true, orderId: true } } },
        });
      } else {
        isNewCall = true;
        try {
          call = await this.prisma.call.create({
            data: {
              cityId,
              rkId,
              callDirection: callDirectionType,
              callId: entry_id,
              phoneClient,
              phoneAts,
              status,
              duration,
              operatorId: operator.id,
              mangoData: summaryData,
              ...(masterId && { masterId }),
            },
            include: { operator: { select: { id: true, name: true } }, city: true, rk: true, appeals: { take: 1, orderBy: { id: 'desc' }, select: { sourceType: true, orderId: true } } },
          });
        } catch (createError: any) {
          if (createError.code === 'P2002') {
            const existingByCallId = await this.prisma.call.findUnique({ where: { callId: entry_id } });
            if (existingByCallId) {
              const existingFinalStatus = (existingByCallId.status === 'answered' && finalStatus !== 'answered') ? 'answered' : finalStatus;
              call = await this.prisma.call.update({
                where: { id: existingByCallId.id },
                data: { callDirection: callDirectionType, status: existingFinalStatus, duration: finalDuration, mangoData: summaryData, ...(masterId && { masterId }) },
                include: { operator: { select: { id: true, name: true } }, appeals: { take: 1, orderBy: { id: 'desc' }, select: { sourceType: true, orderId: true } } },
              });
              isNewCall = false;
            } else {
              throw createError;
            }
          } else {
            throw createError;
          }
        }
      }

      if (isNewCall) {
        await this.realtimeService.broadcastNewCall(call, ['operators', `operator:${operator.id}`]);
        if (callDirectionType === 'inbound' && operator.id && status === 'missed') {
          this.realtimeService.sendCallNotificationToOperator(
            operator.id, call.id, phoneClient, 'call_missed', call.cityId, phone?.rk?.name, call.appeals?.[0]?.sourceType ?? null,
          ).catch(err => this.logger.warn(`Missed call notification failed: ${err.message}`));
        }
      } else {
        await this.realtimeService.broadcastCallUpdated(call, ['operators']);
      }

      await this.realtimeService.broadcastCallEnded(call, ['operators']);

      return { success: true, message: 'Summary processed', data: { callId: entry_id, status, duration } };
    } catch (error) {
      this.logger.error(`Error processing Mango summary: ${error.message}`, error.stack);
      return { success: false, message: error.message };
    }
  }

  private async handleCallAppeared(payload: any, callDirection: string = 'inbound') {
    const { call_id, from, to } = payload;
    this.logger.log(`Call appeared: ${call_id}`);

    const phoneAts = to?.line_number || to?.number || to;
    const phoneClient = from?.number || from;

    const existingCall = await this.prisma.call.findUnique({ where: { callId: call_id } });
    const phone = phoneAts
      ? await this.prisma.phone.findUnique({ where: { number: phoneAts }, include: { city: true, rk: true } })
      : null;

    const operatorSipSource = to?.number || to;
    const sipUsername = this.mangoService.extractSipUsername(operatorSipSource);
    const operator = await this.findOperatorBySip(sipUsername);

    if (existingCall) {
      await this.prisma.call.update({
        where: { callId: call_id },
        data: { phoneClient, phoneAts },
      });
    }

    if (callDirection === 'inbound') {
      const phoneCityId = phone?.cityId;
      const rkName = phone?.rk?.name;
      if (operator?.id) {
        this.realtimeService.sendCallNotificationToOperator(
          operator.id, 0, phoneClient, 'call_incoming', phoneCityId, rkName, null,
        ).catch(err => this.logger.warn(`Incoming call notification failed: ${err.message}`));
      } else {
        this.realtimeService.broadcastCallNotificationToAllOperators(
          0, phoneClient, 'call_incoming', phoneCityId, rkName, null,
        ).catch(err => this.logger.warn(`Broadcast incoming call notification failed: ${err.message}`));
      }
    }

    return { success: true, message: 'Call appeared' };
  }

  private async handleCallConnected(payload: any, callDirection: string = 'inbound') {
    const { call_id, from, to, entry_id, command_id } = payload;
    if (!call_id) return { success: true, message: 'Call ID missing' };

    this.logger.log(`Call connected: ${call_id}`);
    const isCallback = callDirection === 'callback';
    const isOutbound = callDirection === 'outbound';

    const phoneAts = to?.line_number || from?.line_number || to?.number || to;
    const phoneClient = isOutbound ? (to?.number || to) : (from?.number || from);
    const primaryCallId = entry_id || call_id;

    const findExistingCall = async () => {
      let call = await this.prisma.call.findUnique({ where: { callId: call_id } });
      if (call) return call;
      if (entry_id) {
        call = await this.prisma.call.findFirst({
          where: { OR: [{ callId: entry_id }, { mangoData: { path: ['entry_id'], equals: entry_id } }] },
        });
      }
      return call;
    };

    let operator: any;
    let phone: any;
    let existingCall: any;

    if (isCallback) {
      [phone, operator, existingCall] = await Promise.all([
        phoneAts ? this.prisma.phone.findUnique({ where: { number: phoneAts }, include: { city: true, rk: true } }) : null,
        this.prisma.operator.findUnique({ where: { id: this.SYSTEM_OPERATOR_ID } }),
        findExistingCall(),
      ]);
    } else {
      const operatorSipSource = isOutbound ? (from?.number || from) : (to?.number || to);
      const sipUsername = this.mangoService.extractSipUsername(operatorSipSource);

      [operator, phone, existingCall] = await Promise.all([
        this.findOperatorBySip(sipUsername),
        phoneAts ? this.prisma.phone.findUnique({ where: { number: phoneAts }, include: { city: true, rk: true } }) : null,
        findExistingCall(),
      ]);

      if (!operator) {
        this.logger.warn(`Operator not found for call connected`);
        return { success: true, message: 'Operator not found' };
      }
    }

    const cityId = phone?.cityId || this.DEFAULT_CITY_ID;
    const rkId = phone?.rkId || this.DEFAULT_RK_ID;

    let call: any;
    if (existingCall) {
      call = await this.prisma.call.update({
        where: { id: existingCall.id },
        data: { callId: primaryCallId, callDirection, status: 'answered', operatorId: operator.id, mangoData: payload },
        include: { operator: { select: { id: true, name: true } }, city: true, rk: true, appeals: { take: 1, orderBy: { id: 'desc' }, select: { sourceType: true, orderId: true } } },
      });
      await this.realtimeService.broadcastCallUpdated(call, ['operators', `operator:${operator.id}`]);
    } else {
      call = await this.prisma.call.create({
        data: { cityId, rkId, callDirection, callId: primaryCallId, phoneClient, phoneAts, status: 'answered', operatorId: operator.id, mangoData: payload },
        include: { operator: { select: { id: true, name: true } }, city: true, rk: true, appeals: { take: 1, orderBy: { id: 'desc' }, select: { sourceType: true, orderId: true } } },
      });
      await this.realtimeService.broadcastNewCall(call, ['operators', `operator:${operator.id}`]);
    }

    return { success: true, message: 'Call connected', data: { callId: primaryCallId } };
  }

  private async handleCallDisconnected(payload: any, callDirection: string = 'inbound') {
    const { call_id, from, to, entry_id, command_id } = payload;
    if (!call_id) return { success: true, message: 'Call ID missing' };

    this.logger.log(`Call disconnected: ${call_id}`);
    const status = this.mangoService.determineCallStatus(payload);
    const duration = this.mangoService.calculateDuration(payload);
    const isCallback = callDirection === 'callback';
    const isOutbound = callDirection === 'outbound';

    const phoneAts = to?.line_number || from?.line_number || to?.number || to;
    const phoneClient = isOutbound ? (to?.number || to) : (from?.number || from);
    let masterId: number | null = null;

    const findExistingCall = async () => {
      let call = await this.prisma.call.findUnique({ where: { callId: call_id } });
      if (call) return call;
      if (entry_id) {
        call = await this.prisma.call.findFirst({
          where: { OR: [{ callId: entry_id }, { mangoData: { path: ['entry_id'], equals: entry_id } }] },
        });
      }
      return call;
    };

    let operator: any;
    let phone: any;
    let existingCall: any;

    if (isCallback) {
      [phone, operator, existingCall] = await Promise.all([
        phoneAts ? this.prisma.phone.findUnique({ where: { number: phoneAts }, include: { city: true, rk: true } }) : null,
        this.prisma.operator.findUnique({ where: { id: this.SYSTEM_OPERATOR_ID } }),
        findExistingCall(),
      ]);
      if (command_id) masterId = await this.getMasterIdFromCommandId(command_id);
    } else {
      const operatorSipSource = isOutbound ? (from?.number || from) : (to?.number || to);
      const sipUsername = this.mangoService.extractSipUsername(operatorSipSource);

      [operator, phone, existingCall] = await Promise.all([
        this.findOperatorBySip(sipUsername),
        phoneAts ? this.prisma.phone.findUnique({ where: { number: phoneAts }, include: { city: true, rk: true } }) : null,
        findExistingCall(),
      ]);
    }

    const cityId = phone?.cityId || this.DEFAULT_CITY_ID;
    const rkId = phone?.rkId || this.DEFAULT_RK_ID;
    const primaryCallId = entry_id || call_id;

    const finalStatus = (existingCall?.status === 'answered' && status !== 'answered') ? 'answered' : status;
    const finalDuration = (existingCall?.status === 'answered' && duration === 0 && existingCall.duration > 0) ? existingCall.duration : duration;

    let call: any;
    if (existingCall) {
      call = await this.prisma.call.update({
        where: { id: existingCall.id },
        data: { callId: primaryCallId, callDirection, status: finalStatus, duration: finalDuration, mangoData: payload, ...(masterId && { masterId }) },
        include: { operator: { select: { id: true, name: true } }, city: true, rk: true, appeals: { take: 1, orderBy: { id: 'desc' }, select: { sourceType: true, orderId: true } } },
      });
    } else {
      try {
        call = await this.prisma.call.create({
          data: {
            cityId, rkId, callDirection, callId: primaryCallId,
            phoneClient, phoneAts, status: finalStatus, duration: finalDuration,
            operatorId: operator?.id || this.SYSTEM_OPERATOR_ID,
            mangoData: payload, ...(masterId && { masterId }),
          },
          include: { operator: { select: { id: true, name: true } }, city: true, rk: true, appeals: { take: 1, orderBy: { id: 'desc' }, select: { sourceType: true, orderId: true } } },
        });
        await this.realtimeService.broadcastNewCall(call, ['operators']);
      } catch (createError: any) {
        if (createError.code === 'P2002') {
          const existingByCallId = await this.prisma.call.findUnique({ where: { callId: primaryCallId } });
          if (existingByCallId) {
            const existingFinalStatus = (existingByCallId.status === 'answered' && finalStatus !== 'answered') ? 'answered' : finalStatus;
            call = await this.prisma.call.update({
              where: { id: existingByCallId.id },
              data: { callDirection, status: existingFinalStatus, duration: finalDuration, mangoData: payload, ...(masterId && { masterId }) },
              include: { operator: { select: { id: true, name: true } }, appeals: { take: 1, orderBy: { id: 'desc' }, select: { sourceType: true, orderId: true } } },
            });
          } else {
            throw createError;
          }
        } else {
          throw createError;
        }
      }
    }

    await this.realtimeService.broadcastCallEnded(call, ['operators']);

    return { success: true, message: 'Call disconnected', data: { callId: call_id, status: finalStatus, duration: finalDuration } };
  }

  private async handleLegacyFormat(payload: any, callDirection: string = 'inbound') {
    const { call_id, from, to, entry_id, command_id } = payload;

    const status = this.mangoService.determineCallStatus(payload);
    const duration = this.mangoService.calculateDuration(payload);
    const isCallback = callDirection === 'callback';
    const isOutbound = callDirection === 'outbound';

    const phoneAts = typeof to === 'object'
      ? (to?.line_number || from?.line_number || to?.number)
      : (typeof from === 'object' ? from?.line_number : to);

    const phoneClient = isOutbound
      ? (typeof to === 'object' ? (to?.number || to) : to)
      : (typeof from === 'object' ? (from?.number || from) : from);

    let operator: any;
    let phone: any;

    if (isCallback) {
      [phone, operator] = await Promise.all([
        phoneAts ? this.prisma.phone.findUnique({ where: { number: phoneAts }, include: { city: true, rk: true } }) : null,
        this.prisma.operator.findUnique({ where: { id: this.SYSTEM_OPERATOR_ID } }),
      ]);
    } else {
      const operatorSipSource = isOutbound
        ? (typeof from === 'object' ? (from?.number || from) : from)
        : (typeof to === 'object' ? (to?.number || to) : to);
      const sipUsername = this.mangoService.extractSipUsername(operatorSipSource);

      [phone, operator] = await Promise.all([
        phoneAts ? this.prisma.phone.findUnique({ where: { number: phoneAts }, include: { city: true, rk: true } }) : null,
        this.findOperatorBySip(sipUsername),
      ]);
    }

    const cityId = phone?.cityId || this.DEFAULT_CITY_ID;
    const rkId = phone?.rkId || this.DEFAULT_RK_ID;

    if (!call_id) return { success: true, message: 'Call ID missing' };

    const existingCall = await this.prisma.call.findUnique({ where: { callId: call_id } });
    const finalStatus = (existingCall?.status === 'answered' && status !== 'answered') ? 'answered' : status;

    let call: any;
    if (existingCall) {
      call = await this.prisma.call.update({
        where: { callId: call_id },
        data: { callDirection, status: finalStatus, duration, phoneAts, mangoData: payload },
        include: { operator: { select: { id: true, name: true } }, city: true, rk: true, appeals: { take: 1, orderBy: { id: 'desc' }, select: { sourceType: true, orderId: true } } },
      });
      await this.realtimeService.broadcastCallUpdated(call, ['operators']);
    } else {
      call = await this.prisma.call.create({
        data: {
          cityId, rkId, callDirection, callId: call_id,
          phoneClient, phoneAts, duration, status,
          operatorId: operator?.id || this.SYSTEM_OPERATOR_ID,
          mangoData: payload,
        },
        include: { operator: { select: { id: true, name: true } }, city: true, rk: true, appeals: { take: 1, orderBy: { id: 'desc' }, select: { sourceType: true, orderId: true } } },
      });
      await this.realtimeService.broadcastNewCall(call, ['operators']);
    }

    return { success: true, message: 'Webhook processed (legacy)', data: { callId: call_id, status } };
  }

  private async createOrderForCall(call: any, phoneClient: string, operatorId: number) {
    this.logger.warn(
      `createOrderForCall is disabled for call #${call.id}: orders must be created explicitly and linked via appeals`,
    );
  }

  private async getNewStatusId(): Promise<number> {
    if (this.cachedNewStatusId) return this.cachedNewStatusId;
    const result = await this.prisma.$queryRaw<Array<{ id: number }>>`
      SELECT id FROM references_service.order_statuses WHERE code = 'new' LIMIT 1
    `;
    this.cachedNewStatusId = result?.[0]?.id ?? 1;
    return this.cachedNewStatusId;
  }

  private async findOperatorBySip(sipUsername: string) {
    try {
      const cleanNumber = sipUsername?.replace(/\D/g, '');
      if (cleanNumber && cleanNumber.length >= 10 && (cleanNumber.startsWith('7') || cleanNumber.startsWith('8'))) {
        return null;
      }

      if (!sipUsername || sipUsername === 'undefined') return null;

      let operator = await this.prisma.operator.findFirst({
        where: { sipAddress: sipUsername, deletedAt: null, status: 'active' },
      });

      if (!operator && sipUsername.includes('@')) {
        const localPart = sipUsername.split('@')[0];
        operator = await this.prisma.operator.findFirst({
          where: { sipAddress: localPart, deletedAt: null, status: 'active' },
        });
      }

      return operator;
    } catch (error) {
      this.logger.error(`Error finding operator: ${error.message}`);
      return null;
    }
  }

  private async getMasterIdFromCommandId(commandId: string): Promise<number | null> {
    try {
      if (!commandId || !commandId.startsWith('callback_')) return null;

      const parts = commandId.split('_');
      if (parts.length < 2) return null;

      const orderId = parseInt(parts[1], 10);
      if (isNaN(orderId)) return null;

      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        select: { masterId: true },
      });

      return order?.masterId || null;
    } catch (error) {
      this.logger.error(`Error getting masterId from command_id: ${error.message}`);
      return null;
    }
  }

  async processMangoRecording(payload: any) {
    try {
      const { entry_id, call_id, recording_id, recording_state } = payload;

      if (recording_state === 'Started') {
        return { success: true, message: 'Recording started - waiting for completion' };
      }

      if (!recording_id) return { success: false, message: 'Missing recording_id' };

      let call: any;
      if (call_id) {
        call = await this.prisma.call.findFirst({ where: { callId: call_id } });
      } else if (entry_id) {
        call = await this.prisma.call.findFirst({
          where: { mangoData: { path: ['entry_id'], equals: entry_id } },
        });
      }

      if (!call) {
        return { success: false, message: 'Call not found' };
      }

      await this.recordingQueue.add(
        'download',
        { callId: call.id, callIdMango: call.callId, recordingId: recording_id },
        { delay: 5000, jobId: `recording-${call.id}-${recording_id}` }
      );

      return { success: true, message: 'Recording queued for processing', data: { callId: call.callId } };
    } catch (error) {
      this.logger.error(`Error in processMangoRecording: ${error.message}`, error.stack);
      return { success: false, message: error.message };
    }
  }

  private isOutboundCall(from: any, to: any): boolean {
    const fromNumber = typeof from === 'object' ? (from?.number || from?.extension || '') : (from || '');
    const toNumber = typeof to === 'object' ? (to?.number || to?.extension || '') : (to || '');

    if (fromNumber && fromNumber.toString().includes('sip:')) return true;
    if (toNumber && toNumber.toString().includes('sip:')) return false;

    const fromStr = fromNumber.toString().replace(/\D/g, '');
    if (fromStr.length > 0 && fromStr.length <= 4) return true;

    return false;
  }
}
