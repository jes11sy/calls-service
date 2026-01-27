import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MangoService } from '../mango/mango.service';
import { S3Service } from '../s3/s3.service';
import { RealtimeService } from '../realtime/realtime.service';

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);
  // ✅ FIX #34: Отслеживание асинхронных задач
  private pendingTasks: Set<Promise<void>> = new Set();
  private readonly MAX_CONCURRENT_TASKS = 10; // Лимит параллельных задач

  constructor(
    private prisma: PrismaService,
    private mangoService: MangoService,
    private s3Service: S3Service,
    private realtimeService: RealtimeService,
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

      // Игнорируем callback звонки (инициированные через initiateCallback)
      if (command_id && command_id.startsWith('callback_')) {
        this.logger.log(`Ignoring callback call ${call_id}, command_id: ${command_id}`);
        return { success: true, message: 'Callback call ignored' };
      }

      // Игнорируем звонки в IVR
      if (location === 'ivr') {
        this.logger.log(`Ignoring IVR call ${call_id}`);
        return { success: true, message: 'IVR call ignored' };
      }

      // Обрабатываем события по call_state
      if (call_state === 'Appeared') {
        return this.handleCallAppeared(payload);
      } else if (call_state === 'Connected') {
        return this.handleCallConnected(payload);
      } else if (call_state === 'Disconnected') {
        return this.handleCallDisconnected(payload);
      }

      // Fallback для старого формата
      return this.handleLegacyFormat(payload);
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

      // Игнорируем callback звонки
      if (command_id && command_id.startsWith('callback_')) {
        this.logger.log(`Ignoring callback call: ${entry_id}, command_id: ${command_id}`);
        return { success: true, message: 'Callback call ignored' };
      }

      // Игнорируем исходящие звонки (call_direction = 2)
      if (call_direction === 2) {
        this.logger.log(`Ignoring outbound call: ${entry_id}`);
        return { success: true, message: 'Outbound call ignored' };
      }

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

      // ✅ FIX: Параллельное выполнение независимых запросов (было последовательно)
      const sipUsername = this.mangoService.extractSipUsername(to?.number || to);
      const [phoneResult, operator] = await Promise.all([
        this.prisma.phone.findUnique({ where: { number: phoneAts } }),
        this.findOperatorBySip(sipUsername),
      ]);

      let phone = phoneResult;

      if (!operator) {
        this.logger.warn(`Operator not found for SIP: ${sipUsername}`);
        return { success: true, message: 'Operator not found' };
      }

      // Определяем город и РК из phone или operator
      const city = phone?.city || operator.city || 'Неизвестно';
      const rk = phone?.rk || 'MANGO';

      // Создаем phone если не существует
      if (!phone) {
        phone = await this.findOrCreatePhone(phoneAts, city, rk);
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
        
        this.logger.log(`Updated existing call: ${existingCall.id}, callId: ${entry_id}, avitoName: ${phone?.avitoName || 'null'}`);
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

  private async handleCallAppeared(payload: any) {
    const { call_id, from, to, create_time, timestamp, command_id } = payload;

    this.logger.log(`Call appeared: ${call_id}`);

    // Игнорируем callback звонки
    if (command_id && command_id.startsWith('callback_')) {
      this.logger.log(`Ignoring callback call: ${call_id}, command_id: ${command_id}`);
      return { success: true, message: 'Callback call ignored' };
    }

    // Игнорируем исходящие звонки (from содержит SIP - это сотрудник звонит клиенту)
    if (this.isOutboundCall(from, to)) {
      this.logger.log(`Ignoring outbound call: ${call_id}`);
      return { success: true, message: 'Outbound call ignored' };
    }

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
          avitoName: phone?.avitoName || null, // Берем avitoName из phone
        },
      });
    }

    return {
      success: true,
      message: 'Call appeared',
    };
  }

  private async handleCallConnected(payload: any) {
    const { call_id, from, to, answer_time, create_time, timestamp, command_id } = payload;

    if (!call_id) {
      this.logger.warn('Call ID is missing in Connected event');
      return { success: true, message: 'Call ID missing' };
    }

    this.logger.log(`Call connected: ${call_id}`);

    // Игнорируем callback звонки
    if (command_id && command_id.startsWith('callback_')) {
      this.logger.log(`Ignoring callback call: ${call_id}, command_id: ${command_id}`);
      return { success: true, message: 'Callback call ignored' };
    }

    // Игнорируем исходящие звонки (from содержит SIP - это сотрудник звонит клиенту)
    if (this.isOutboundCall(from, to)) {
      this.logger.log(`Ignoring outbound call: ${call_id}`);
      return { success: true, message: 'Outbound call ignored' };
    }

    // ✅ FIX: Параллельное выполнение независимых запросов (было последовательно)
    const sipUsername = this.mangoService.extractSipUsername(to?.number || to);
    const phoneAts = to?.line_number || to?.number || to;
    const phoneClient = from?.number || from;

    const [operator, phoneResult, existingCall] = await Promise.all([
      this.findOperatorBySip(sipUsername),
      this.prisma.phone.findUnique({ where: { number: phoneAts } }),
      this.prisma.call.findUnique({ where: { callId: call_id } }),
    ]);

    if (!operator) {
      this.logger.warn(`Operator not found for SIP: ${sipUsername}`);
      return { success: true, message: 'Operator not found' };
    }

    let phone = phoneResult;

    // Определяем город и РК из phone или operator
    const city = phone?.city || operator.city || 'Не указан';
    const rk = phone?.rk || 'MANGO';

    // Создаем phone если не существует
    if (!phone) {
      phone = await this.findOrCreatePhone(phoneAts, city, rk);
    }

    let call;
    if (existingCall) {
      // Обновляем статус на answered
      call = await this.prisma.call.update({
        where: { callId: call_id },
        data: {
          status: 'answered',
          operatorId: operator.id,
          avitoName: phone?.avitoName || null, // Берем avitoName из phone
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
          avitoName: phone?.avitoName || null, // Берем avitoName из phone
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

  private async handleCallDisconnected(payload: any) {
    const { call_id, from, to, entry_id, disconnect_reason, create_time, answer_time, end_time, timestamp, command_id } = payload;

    if (!call_id) {
      this.logger.warn('Call ID is missing in Disconnected event');
      return { success: true, message: 'Call ID missing' };
    }

    this.logger.log(`Call disconnected: ${call_id}, reason: ${disconnect_reason}`);

    // Игнорируем callback звонки
    if (command_id && command_id.startsWith('callback_')) {
      this.logger.log(`Ignoring callback call: ${call_id}, command_id: ${command_id}`);
      return { success: true, message: 'Callback call ignored' };
    }

    // Игнорируем исходящие звонки (from содержит SIP - это сотрудник звонит клиенту)
    if (this.isOutboundCall(from, to)) {
      this.logger.log(`Ignoring outbound call: ${call_id}`);
      return { success: true, message: 'Outbound call ignored' };
    }

    const status = this.mangoService.determineCallStatus(payload);
    const duration = this.mangoService.calculateDuration(payload);
    const sipUsername = this.mangoService.extractSipUsername(to?.number || to);
    const phoneAts = to?.line_number || to?.number || to;

    // ✅ FIX: Параллельное выполнение независимых запросов (было последовательно)
    const [operator, phoneResult, existingCall] = await Promise.all([
      this.findOperatorBySip(sipUsername),
      this.prisma.phone.findUnique({ where: { number: phoneAts } }),
      this.prisma.call.findUnique({ where: { callId: call_id } }),
    ]);

    let phone = phoneResult;
    
    // Определяем город и РК из phone или operator
    const city = phone?.city || operator?.city || 'Неизвестно';
    const rk = phone?.rk || 'MANGO';
    
    // Создаем phone если не существует, с правильными значениями
    if (!phone) {
      phone = await this.findOrCreatePhone(phoneAts, city, rk);
    }

    let call;
    if (existingCall) {
      // Обновляем финальными данными
      call = await this.prisma.call.update({
        where: { callId: call_id },
        data: {
          status,
          duration,
          avitoName: phone?.avitoName || null, // Берем avitoName из phone
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
          avitoName: phone?.avitoName || null, // Берем avitoName из phone
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

  private async handleLegacyFormat(payload: any) {
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

    // Игнорируем callback звонки
    if (command_id && command_id.startsWith('callback_')) {
      this.logger.log(`Ignoring callback call (legacy): ${call_id || 'unknown'}, command_id: ${command_id}`);
      return { success: true, message: 'Callback call ignored' };
    }

    // Игнорируем исходящие звонки (from содержит SIP - это сотрудник звонит клиенту)
    if (this.isOutboundCall(from, to)) {
      this.logger.log(`Ignoring outbound call (legacy): ${call_id || 'unknown'}`);
      return { success: true, message: 'Outbound call ignored' };
    }

    const status = this.mangoService.determineCallStatus(payload);
    const duration = this.mangoService.calculateDuration(payload);
    const sipUsername = this.mangoService.extractSipUsername(to);
    const operator = await this.findOperatorBySip(sipUsername);

    // Создаем или находим номер телефона АТС
    const phoneAts = typeof to === 'object' ? (to?.line_number || to?.number || to) : to;
    const phoneClient = typeof from === 'object' ? (from?.number || from) : from;
    
    // Сначала ищем существующий phone
    let phone = await this.prisma.phone.findUnique({
      where: { number: phoneAts },
    });
    
    // Определяем город и РК из phone или operator
    const city = phone?.city || operator?.city || 'Неизвестно';
    const rk = phone?.rk || 'MANGO';
    
    // Создаем phone если не существует, с правильными значениями
    if (!phone) {
      phone = await this.findOrCreatePhone(phoneAts, city, rk);
    }

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
          avitoName: phone?.avitoName || null, // Берем avitoName из phone
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
          avitoName: phone?.avitoName || null, // Берем avitoName из phone
          dateCreate: new Date(create_time || timestamp * 1000),
          duration,
          status,
          operatorId: operator?.id || 1,
          mangoData: payload,
        },
      });
    }

    this.logger.log(`Legacy call processed: ${call_id}, status: ${status}`);

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

  private async findOrCreatePhone(phoneNumber: string, city: string = 'Неизвестно', rk: string = 'Неизвестно'): Promise<any> {
    // Если номер не указан, возвращаем null
    if (!phoneNumber || phoneNumber === 'undefined') {
      this.logger.warn('Phone number is undefined, skipping phone upsert');
      return null;
    }

    return this.prisma.phone.upsert({
      where: { number: phoneNumber },
      update: {},
      create: {
        number: phoneNumber,
        rk,
        city,
        avitoName: null,
      },
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
        // Событие "Completed" - есть call_id
        call = await this.prisma.call.findFirst({
          where: { callId: call_id },
        });
      } else if (entry_id) {
        // Событие "record/added" - только entry_id
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

      // ✅ FIX #34: Используем отслеживаемую асинхронную задачу вместо setImmediate
      // TODO: Migrate to proper job queue (Bull/Redis) for production
      const task = this.scheduleRecordingDownload(call, recording_id);

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

  /**
   * ✅ FIX #34: Планирование скачивания записи с отслеживанием
   * Ограничивает количество параллельных задач и логирует их завершение
   */
  private async scheduleRecordingDownload(call: any, recording_id: string): Promise<void> {
    // Проверяем лимит параллельных задач
    if (this.pendingTasks.size >= this.MAX_CONCURRENT_TASKS) {
      this.logger.warn(
        `Max concurrent tasks reached (${this.MAX_CONCURRENT_TASKS}), waiting for task to complete...`
      );
      // Ждём завершения хотя бы одной задачи
      await Promise.race(this.pendingTasks);
    }

    // Создаём отслеживаемую задачу
    const task = (async () => {
      try {
        this.logger.log(`Starting recording download for call ${call.callId}, recording ${recording_id}`);
        await this.processRecordingDownload(call, recording_id);
        this.logger.log(`✅ Successfully completed recording download for call ${call.callId}`);
      } catch (error) {
        this.logger.error(
          `❌ Failed to download recording for call ${call.callId}: ${error.message}`,
          error.stack
        );
        // TODO: Add retry logic or dead letter queue here
      } finally {
        // Удаляем задачу из отслеживания
        this.pendingTasks.delete(task);
        this.logger.debug(`Pending tasks: ${this.pendingTasks.size}/${this.MAX_CONCURRENT_TASKS}`);
      }
    })();

    // Добавляем в отслеживание
    this.pendingTasks.add(task);
  }

  private async processRecordingDownload(call: any, recording_id: string) {
    // Ждем 5 секунд (Mango обрабатывает файл) но не блокируем event loop
    await new Promise(resolve => setTimeout(resolve, 5000));

    if (!this.mangoService.isConfigured()) {
      this.logger.warn('Mango API not configured - cannot download recording');
      throw new Error('Mango API not configured');
    }

    // Скачиваем запись
    const buffer = await this.mangoService.downloadRecording(recording_id);

    // Загружаем в S3 если настроено
    if (!this.s3Service.isConfigured()) {
      this.logger.warn('S3 not configured - recording not uploaded');
      return;
    }

    const filename = `${call.callId}_${Date.now()}.mp3`;
    const s3Key = await this.s3Service.uploadRecording(filename, buffer);

    // Обновляем звонок
    await this.prisma.call.update({
      where: { id: call.id },
      data: {
        recordUrl: `s3://${s3Key}`,
        recordingPath: s3Key,
        recordingProcessedAt: new Date(),
      },
    });

    this.logger.log(`Recording uploaded to S3: ${s3Key}`);

    // Broadcast обновления
    await this.realtimeService.broadcastCallUpdated(
      { ...call, recordUrl: `s3://${s3Key}`, recordingPath: s3Key, recordingProcessedAt: new Date() },
      ['operators'],
    );
  }
}



