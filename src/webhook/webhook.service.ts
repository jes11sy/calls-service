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

  constructor(
    private prisma: PrismaService,
    private mangoService: MangoService,
    private realtimeService: RealtimeService,
    @InjectQueue(RECORDING_QUEUE) private recordingQueue: Queue<RecordingJobData>,
  ) {}

  async processMangoWebhook(payload: any) {
    try {
      this.logger.log(`Processing Mango webhook: ${JSON.stringify(payload)}`);

      const {
        call_id,
        call_state,
        from,
        to,
        entry_id,
        location,
        timestamp,
        create_time,
        answer_time,
        end_time,
        disconnect_reason,
        command_id,
      } = payload;

      // Игнорируем звонки в IVR (не дошедшие до оператора)
      if (location === 'ivr') {
        this.logger.log(`Ignoring IVR call ${call_id}`);
        return { success: true, message: 'IVR call ignored' };
      }

      // Определяем направление звонка
      const isCallback = command_id && command_id.startsWith('callback_');
      const isOutbound = this.isOutboundCall(from, to);
      const callDirection = isCallback ? 'callback' : (isOutbound ? 'outbound' : 'inbound');

      // Обрабатываем события по call_state
      if (call_state === 'Appeared') {
        return this.handleCallAppeared(payload, callDirection);
      } else if (call_state === 'Connected') {
        return this.handleCallConnected(payload, callDirection);
      } else if (call_state === 'Disconnected') {
        return this.handleCallDisconnected(payload, callDirection);
      }

      // Fallback для старого формата
      return this.handleLegacyFormat(payload, callDirection);
    } catch (error) {
      this.logger.error(`Error processing Mango webhook: ${error.message}`, error.stack);
      return {
        success: false,
        message: error.message,
      };
    }
  }

  async processMangoSummary(summaryData: any) {
    try {
      this.logger.log(`Processing Mango summary: ${JSON.stringify(summaryData)}`);

      const {
        entry_id,
        call_direction,
        from,
        to,
        line_number,
        create_time,
        forward_time,
        talk_time,
        end_time,
        entry_result,
        disconnect_reason,
        command_id,
      } = summaryData;

      if (!entry_id) {
        this.logger.warn('Entry ID is missing in summary event');
        return { success: true, message: 'Entry ID missing' };
      }

      // Определяем направление звонка
      const isCallback = command_id && command_id.startsWith('callback_');
      // call_direction: 1 = входящий, 2 = исходящий
      const isOutbound = call_direction === 2;
      const callDirectionType = isCallback ? 'callback' : (isOutbound ? 'outbound' : 'inbound');
      
      this.logger.log(`Processing ${callDirectionType} call: ${entry_id}`);

      // Определяем статус звонка и длительность
      let status = 'missed';
      let duration = 0;
      
      // talk_time и end_time - это Unix timestamps в секундах
      if (talk_time && end_time && talk_time > 0) {
        duration = end_time - talk_time; // уже в секундах
        status = 'answered';
      } else if (entry_result === 1) {
        // entry_result = 1 означает успешный звонок
        status = 'answered';
      } else if (entry_result === 0) {
        status = 'missed';
      }
      
      // Если разговор был, но нет talk_time (редкий случай)
      if (duration > 0) {
        status = 'answered';
      }

      // Определяем номер АТС
      const phoneAts = line_number || to?.line_number || to?.number || to;
      const phoneClient = from?.number || from;

      let operator;
      let phone;

      if (isCallback) {
        // Для callback-звонков используем оператора "Система" (ID = 1)
        const [phoneResult, systemOperator] = await Promise.all([
          this.prisma.phone.findUnique({ where: { number: phoneAts } }),
          this.prisma.callcentreOperator.findUnique({ where: { id: 1 } }),
        ]);
        phone = phoneResult;
        operator = systemOperator;
        this.logger.log(`Callback call - using System operator (ID: 1)`);
      } else {
        // Для обычных звонков ищем по SIP
        const sipUsername = this.mangoService.extractSipUsername(to?.number || to);
        const [phoneResult, foundOperator] = await Promise.all([
          this.prisma.phone.findUnique({ where: { number: phoneAts } }),
          this.findOperatorBySip(sipUsername),
        ]);
        phone = phoneResult;
        operator = foundOperator;

        if (!operator) {
          this.logger.warn(`Operator not found for SIP: ${sipUsername}`);
          return { success: true, message: 'Operator not found' };
        }
      }

      // Определяем город и РК из phone или operator
      const city = phone?.city || operator?.city || 'Неизвестно';
      const rk = phone?.rk || 'Уточнить';

      // Создаем phone если не существует
      if (!phone) {
        // Не создаём автоматически - phone остаётся null если не найден
      }

      // Проверяем, существует ли звонок по entry_id в JSON mangoData
      // (звонок мог быть создан в Connected с call_id, а не entry_id)
      const existingCall = await this.prisma.call.findFirst({
        where: {
          OR: [
            // 1. Ищем по callId = entry_id (если уже обновлен)
            { callId: entry_id },
            // 2. Ищем по entry_id в JSON поле mangoData
            {
              mangoData: {
                path: ['entry_id'],
                equals: entry_id,
              },
            },
            // 3. Ищем по номеру клиента, АТС и оператору с временным окном
            {
              phoneClient,
              phoneAts,
              operatorId: operator.id,
              dateCreate: {
                gte: new Date((create_time - 10) * 1000), // ±10 секунд
                lte: new Date((create_time + 10) * 1000),
              },
            },
          ],
        },
        orderBy: {
          dateCreate: 'desc',
        },
      });

      let call;
      let isNewCall = false;
      
      if (existingCall) {
        // Обновляем существующий звонок
        call = await this.prisma.call.update({
          where: { id: existingCall.id },
          data: {
            callId: entry_id, // Обновляем callId на entry_id из Summary
            status,
            duration,
            phoneClient,
            phoneAts,
            avitoName: phone?.avitoName || null, // Берем avitoName из phone
            dateCreate: new Date(create_time * 1000),
            mangoData: summaryData,
          },
          include: {
            operator: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        });
        
        this.logger.log(`Updated existing call: ${existingCall.id}, callId: ${entry_id}, direction: ${callDirectionType}, avitoName: ${phone?.avitoName || 'null'}`);
      } else {
        isNewCall = true;
        // Создаем новый звонок
        call = await this.prisma.call.create({
          data: {
            rk,
            city,
            callId: entry_id,
            phoneClient,
            phoneAts,
            avitoName: phone?.avitoName || null, // Берем avitoName из phone
            dateCreate: new Date(create_time * 1000),
            status,
            duration,
            operatorId: operator.id,
            mangoData: summaryData,
          },
          include: {
            operator: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        });
      }

      // Broadcast в зависимости от того, новый звонок или обновленный
      if (isNewCall) {
        // Broadcast нового звонка
        await this.realtimeService.broadcastNewCall(call, [
          'operators',
          `operator:${operator.id}`,
        ]);
        this.logger.log(`Broadcasted new call: ${call.id}`);
      } else {
        // Broadcast обновления существующего звонка
        await this.realtimeService.broadcastCallUpdated(call, ['operators']);
        this.logger.log(`Broadcasted call update: ${call.id}`);
      }

      // Broadcast обновления о завершении звонка
      await this.realtimeService.broadcastCallEnded(call, ['operators']);

      this.logger.log(`Summary processed: entry_id=${entry_id}, status=${status}, duration=${duration}`);

      return {
        success: true,
        message: 'Summary processed',
        data: { callId: entry_id, status, duration },
      };
    } catch (error) {
      this.logger.error(`Error processing Mango summary: ${error.message}`, error.stack);
      return {
        success: false,
        message: error.message,
      };
    }
  }

  private async handleCallAppeared(payload: any, callDirection: string = 'inbound') {
    const { call_id, from, to, create_time, timestamp, command_id } = payload;

    this.logger.log(`Call appeared: ${call_id}, direction: ${callDirection}`);

    // Проверяем, существует ли звонок
    const existingCall = await this.prisma.call.findUnique({
      where: { callId: call_id },
    });

    if (existingCall) {
      const phoneAts = to?.line_number || to?.number || to;
      // Ищем phone для получения avitoName
      const phone = await this.prisma.phone.findUnique({
        where: { number: phoneAts },
      });
      
      // Обновляем данные
      await this.prisma.call.update({
        where: { callId: call_id },
        data: {
          phoneClient: from?.number || from,
          phoneAts: phoneAts,
          avitoName: phone?.avitoName || null,
        },
      });
    }

    return {
      success: true,
      message: 'Call appeared',
    };
  }

  private async handleCallConnected(payload: any, callDirection: string = 'inbound') {
    const { call_id, from, to, answer_time, create_time, timestamp, command_id } = payload;

    if (!call_id) {
      this.logger.warn('Call ID is missing in Connected event');
      return { success: true, message: 'Call ID missing' };
    }

    this.logger.log(`Call connected: ${call_id}, direction: ${callDirection}`);

    const isCallback = callDirection === 'callback';
    const phoneAts = to?.line_number || to?.number || to;
    const phoneClient = from?.number || from;

    let operator;
    let phone;
    let existingCall;

    if (isCallback) {
      // Для callback-звонков используем оператора "Система" (ID = 1)
      const [phoneResult, systemOperator, call] = await Promise.all([
        this.prisma.phone.findUnique({ where: { number: phoneAts } }),
        this.prisma.callcentreOperator.findUnique({ where: { id: 1 } }),
        this.prisma.call.findUnique({ where: { callId: call_id } }),
      ]);
      phone = phoneResult;
      operator = systemOperator;
      existingCall = call;
    } else {
      // Для обычных звонков ищем по SIP
      const sipUsername = this.mangoService.extractSipUsername(to?.number || to);
      const [foundOperator, phoneResult, call] = await Promise.all([
        this.findOperatorBySip(sipUsername),
        this.prisma.phone.findUnique({ where: { number: phoneAts } }),
        this.prisma.call.findUnique({ where: { callId: call_id } }),
      ]);
      operator = foundOperator;
      phone = phoneResult;
      existingCall = call;

      if (!operator) {
        this.logger.warn(`Operator not found for SIP: ${sipUsername}`);
        return { success: true, message: 'Operator not found' };
      }
    }

    // Определяем город и РК из phone или operator
    const city = phone?.city || operator?.city || 'Не указан';
    const rk = phone?.rk || 'Уточнить';

    // Создаем phone если не существует
    if (!phone) {
      // Не создаём автоматически - phone остаётся null если не найден
    }

    let call;
    if (existingCall) {
      // Обновляем статус на answered
      call = await this.prisma.call.update({
        where: { callId: call_id },
        data: {
          status: 'answered',
          operatorId: operator.id,
          avitoName: phone?.avitoName || null,
          mangoData: payload,
        },
      });
    } else {
      // Создаем новый звонок
      call = await this.prisma.call.create({
        data: {
          rk,
          city,
          callId: call_id,
          phoneClient,
          phoneAts: phoneAts,
          avitoName: phone?.avitoName || null,
          dateCreate: new Date(create_time || answer_time || timestamp * 1000),
          status: 'answered',
          operatorId: operator.id,
          mangoData: payload,
        },
        include: {
          operator: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      // Broadcast нового звонка
      await this.realtimeService.broadcastNewCall(call, [
        'operators',
        `operator:${operator.id}`,
      ]);
    }

    return {
      success: true,
      message: 'Call connected',
      data: { callId: call_id },
    };
  }

  private async handleCallDisconnected(payload: any, callDirection: string = 'inbound') {
    const { call_id, from, to, entry_id, disconnect_reason, create_time, answer_time, end_time, timestamp, command_id } = payload;

    if (!call_id) {
      this.logger.warn('Call ID is missing in Disconnected event');
      return { success: true, message: 'Call ID missing' };
    }

    this.logger.log(`Call disconnected: ${call_id}, reason: ${disconnect_reason}, direction: ${callDirection}`);

    const status = this.mangoService.determineCallStatus(payload);
    const duration = this.mangoService.calculateDuration(payload);
    const isCallback = callDirection === 'callback';
    const phoneAts = to?.line_number || to?.number || to;

    let operator;
    let phone;
    let existingCall;

    if (isCallback) {
      // Для callback-звонков используем оператора "Система" (ID = 1)
      const [phoneResult, systemOperator, call] = await Promise.all([
        this.prisma.phone.findUnique({ where: { number: phoneAts } }),
        this.prisma.callcentreOperator.findUnique({ where: { id: 1 } }),
        this.prisma.call.findUnique({ where: { callId: call_id } }),
      ]);
      phone = phoneResult;
      operator = systemOperator;
      existingCall = call;
    } else {
      // Для обычных звонков ищем по SIP
      const sipUsername = this.mangoService.extractSipUsername(to?.number || to);
      const [foundOperator, phoneResult, call] = await Promise.all([
        this.findOperatorBySip(sipUsername),
        this.prisma.phone.findUnique({ where: { number: phoneAts } }),
        this.prisma.call.findUnique({ where: { callId: call_id } }),
      ]);
      operator = foundOperator;
      phone = phoneResult;
      existingCall = call;
    }
    
    // Определяем город и РК из phone или operator
    const city = phone?.city || operator?.city || 'Неизвестно';
    const rk = phone?.rk || 'Уточнить';

    let call;
    if (existingCall) {
      // Обновляем финальными данными
      call = await this.prisma.call.update({
        where: { callId: call_id },
        data: {
          status,
          duration,
          avitoName: phone?.avitoName || null,
          mangoData: payload,
        },
        include: {
          operator: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });
    } else {
      // Создаем звонок при завершении (если не был создан раньше)
      call = await this.prisma.call.create({
        data: {
          rk,
          city,
          callId: call_id,
          phoneClient: from?.number || from,
          phoneAts: phoneAts,
          avitoName: phone?.avitoName || null,
          dateCreate: new Date(create_time || timestamp * 1000),
          status,
          duration,
          operatorId: operator?.id || 1, // Fallback to operator 1
          mangoData: payload,
        },
        include: {
          operator: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      // Broadcast нового звонка
      await this.realtimeService.broadcastNewCall(call, ['operators']);
    }

    // Broadcast обновления
    await this.realtimeService.broadcastCallEnded(call, ['operators']);

    return {
      success: true,
      message: 'Call disconnected',
      data: { callId: call_id, status, duration },
    };
  }

  private async handleLegacyFormat(payload: any, callDirection: string = 'inbound') {
    const {
      call_id,
      from,
      to,
      entry_id,
      command_id,
      result,
      disconnect_reason,
      timestamp,
      create_time,
      answer_time,
      end_time,
    } = payload;

    const status = this.mangoService.determineCallStatus(payload);
    const duration = this.mangoService.calculateDuration(payload);
    const isCallback = callDirection === 'callback';

    // Создаем или находим номер телефона АТС
    const phoneAts = typeof to === 'object' ? (to?.line_number || to?.number || to) : to;
    const phoneClient = typeof from === 'object' ? (from?.number || from) : from;
    
    let operator;
    let phone;

    if (isCallback) {
      // Для callback-звонков используем оператора "Система" (ID = 1)
      const [phoneResult, systemOperator] = await Promise.all([
        this.prisma.phone.findUnique({ where: { number: phoneAts } }),
        this.prisma.callcentreOperator.findUnique({ where: { id: 1 } }),
      ]);
      phone = phoneResult;
      operator = systemOperator;
    } else {
      // Для обычных звонков ищем по SIP
      const sipUsername = this.mangoService.extractSipUsername(to);
      const [phoneResult, foundOperator] = await Promise.all([
        this.prisma.phone.findUnique({ where: { number: phoneAts } }),
        this.findOperatorBySip(sipUsername),
      ]);
      phone = phoneResult;
      operator = foundOperator;
    }
    
    // Определяем город и РК из phone или operator
    const city = phone?.city || operator?.city || 'Неизвестно';
    const rk = phone?.rk || 'Уточнить';

    // Если нет call_id, не можем обработать звонок
    if (!call_id) {
      this.logger.warn('Call ID is missing in legacy format, skipping');
      return { success: true, message: 'Call ID missing' };
    }

    const existingCall = await this.prisma.call.findUnique({
      where: { callId: call_id },
    });

    let call;
    if (existingCall) {
      call = await this.prisma.call.update({
        where: { callId: call_id },
        data: {
          status,
          duration,
          phoneAts,
          avitoName: phone?.avitoName || null,
          dateCreate: new Date(create_time || timestamp * 1000),
          mangoData: payload,
        },
      });
    } else {
      call = await this.prisma.call.create({
        data: {
          rk,
          city,
          callId: call_id,
          phoneClient,
          phoneAts,
          avitoName: phone?.avitoName || null,
          dateCreate: new Date(create_time || timestamp * 1000),
          duration,
          status,
          operatorId: operator?.id || 1,
          mangoData: payload,
        },
      });
    }

    this.logger.log(`Legacy call processed: ${call_id}, status: ${status}, direction: ${callDirection}`);

    return {
      success: true,
      message: 'Webhook processed (legacy)',
      data: { callId: call_id, status },
    };
  }

  private async findOperatorBySip(sipUsername: string) {
    try {
      // Ищем оператора по SIP-адресу
      const operator = await this.prisma.callcentreOperator.findFirst({
        where: { sipAddress: sipUsername },
      });

      if (operator) {
        this.logger.log(`Found operator by SIP: ${operator.name} (${operator.id})`);
        return operator;
      }

      // Fallback - используем оператора с ID = 1
      this.logger.warn(`Operator not found for SIP: ${sipUsername}, using fallback`);
      const fallbackOperator = await this.prisma.callcentreOperator.findUnique({
        where: { id: 1 },
      });

      return fallbackOperator;
    } catch (error) {
      this.logger.error(`Error finding operator: ${error.message}`);
      return null;
    }
  }

  /**
   * Ищет номер телефона в таблице phones
   * НЕ создаёт новые записи - только поиск существующих
   */
  private async findPhone(phoneNumber: string): Promise<any> {
    // Если номер не указан, возвращаем null
    if (!phoneNumber || phoneNumber === 'undefined') {
      this.logger.warn('Phone number is undefined, skipping phone lookup');
      return null;
    }

    return this.prisma.phone.findUnique({
      where: { number: phoneNumber },
    });
  }

  /**
   * Определяет, является ли звонок исходящим (от сотрудника)
   * Исходящий звонок: from содержит SIP-адрес сотрудника
   * Входящий звонок: to содержит SIP-адрес сотрудника
   */
  private isOutboundCall(from: any, to: any): boolean {
    const fromNumber = typeof from === 'object' ? (from?.number || from?.extension || '') : (from || '');
    const toNumber = typeof to === 'object' ? (to?.number || to?.extension || '') : (to || '');

    // Если from содержит "sip:" - это сотрудник звонит клиенту (исходящий)
    if (fromNumber && fromNumber.toString().includes('sip:')) {
      return true;
    }

    // Если to содержит "sip:" - это клиент звонит сотруднику (входящий)
    if (toNumber && toNumber.toString().includes('sip:')) {
      return false;
    }

    // Дополнительная проверка: если from - это короткий номер (внутренний номер сотрудника)
    const fromStr = fromNumber.toString().replace(/\D/g, '');
    if (fromStr.length > 0 && fromStr.length <= 4) {
      // Короткий номер (например, 101, 102) - это сотрудник
      return true;
    }

    // По умолчанию считаем входящим
    return false;
  }

  async processMangoRecording(payload: any) {
    try {
      const { entry_id, call_id, recording_id, recording_state } = payload;

      this.logger.log(`Recording webhook: entry_id=${entry_id}, call_id=${call_id}, recording_id=${recording_id}, state=${recording_state}`);

      // Игнорируем Started события
      if (recording_state === 'Started') {
        return {
          success: true,
          message: 'Recording started - waiting for completion',
        };
      }

      if (!recording_id) {
        return { success: false, message: 'Missing recording_id' };
      }

      // Находим звонок:
      // 1. Если есть call_id (событие "Completed") - ищем по call_id
      // 2. Если нет call_id (событие "record/added") - ищем по entry_id в mangoData
      let call;
      
      if (call_id) {
        call = await this.prisma.call.findFirst({
          where: { callId: call_id },
        });
      } else if (entry_id) {
        call = await this.prisma.call.findFirst({
          where: {
            mangoData: {
              path: ['entry_id'],
              equals: entry_id,
            },
          },
        });
      }

      if (!call) {
        this.logger.warn(`Call not found for call_id=${call_id}, entry_id=${entry_id}`);
        return {
          success: false,
          message: 'Call not found',
        };
      }

      this.logger.log(`Found call ID: ${call.id} for recording_id: ${recording_id}`);

      // Добавляем задачу в очередь Redis (с задержкой 5 секунд чтобы Mango подготовил файл)
      await this.recordingQueue.add(
        'download',
        {
          callId: call.id,
          callIdMango: call.callId,
          recordingId: recording_id,
        },
        {
          delay: 5000, // 5 секунд задержка
          jobId: `recording-${call.id}-${recording_id}`, // Дедупликация
        }
      );

      this.logger.log(`📥 Recording job queued for call ${call.id}`);

      return {
        success: true,
        message: 'Recording queued for processing',
        data: { callId: call.callId },
      };
    } catch (error) {
      this.logger.error(`Error in processMangoRecording: ${error.message}`, error.stack);
      return {
        success: false,
        message: error.message,
      };
    }
  }
}



