import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MangoService } from '../mango/mango.service';
import { S3Service } from '../s3/s3.service';
import { RealtimeService } from '../realtime/realtime.service';

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

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
      } = payload;

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
      } = summaryData;

      if (!entry_id) {
        this.logger.warn('Entry ID is missing in summary event');
        return { success: true, message: 'Entry ID missing' };
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

      // Сначала ищем или создаем номер телефона АТС
      let phone = await this.prisma.phone.findUnique({
        where: { number: phoneAts },
      });

      // Извлекаем SIP username из to.number
      const sipUsername = this.mangoService.extractSipUsername(to?.number || to);
      const operator = await this.findOperatorBySip(sipUsername);

      if (!operator) {
        this.logger.warn(`Operator not found for SIP: ${sipUsername}`);
        return { success: true, message: 'Operator not found' };
      }

      // Определяем город и РК из phone или operator
      const city = phone?.city || operator.city || 'Неизвестно';
      const rk = phone?.rk || 'MANGO';

      // Пытаемся найти phone если не существует (НЕ создаем автоматически)
      if (!phone) {
        phone = await this.findPhone(phoneAts);
      }

      // Проверяем, существует ли звонок по entry_id или по комбинации параметров
      const existingCall = await this.prisma.call.findFirst({
        where: {
          OR: [
            { callId: entry_id },
            // Ищем по номеру клиента, АТС и оператору (для случая когда звонок создан при Connected)
            {
              phoneClient,
              phoneAts,
              operatorId: operator.id,
              dateCreate: {
                gte: new Date((create_time - 5) * 1000), // ±5 секунд
                lte: new Date((create_time + 5) * 1000),
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
    const { call_id, from, to, create_time, timestamp } = payload;

    this.logger.log(`Call appeared: ${call_id}`);

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
    const { call_id, from, to, answer_time, create_time, timestamp } = payload;

    if (!call_id) {
      this.logger.warn('Call ID is missing in Connected event');
      return { success: true, message: 'Call ID missing' };
    }

    this.logger.log(`Call connected: ${call_id}`);

    const sipUsername = this.mangoService.extractSipUsername(to?.number || to);
    const operator = await this.findOperatorBySip(sipUsername);

    if (!operator) {
      this.logger.warn(`Operator not found for SIP: ${sipUsername}`);
      return { success: true, message: 'Operator not found' };
    }

    // Определяем номер АТС
    const phoneAts = to?.line_number || to?.number || to;
    const phoneClient = from?.number || from;

    // Ищем номер телефона АТС
    let phone = await this.prisma.phone.findUnique({
      where: { number: phoneAts },
    });

    // Определяем город и РК из phone или operator
    const city = phone?.city || operator.city || 'Не указан';
    const rk = phone?.rk || 'MANGO';

    // Пытаемся найти phone если не существует (НЕ создаем автоматически)
    if (!phone) {
      phone = await this.findPhone(phoneAts);
    }

    // Проверяем, существует ли звонок
    const existingCall = await this.prisma.call.findUnique({
      where: { callId: call_id },
    });

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
    const { call_id, from, to, entry_id, disconnect_reason, create_time, answer_time, end_time, timestamp } = payload;

    if (!call_id) {
      this.logger.warn('Call ID is missing in Disconnected event');
      return { success: true, message: 'Call ID missing' };
    }

    this.logger.log(`Call disconnected: ${call_id}, reason: ${disconnect_reason}`);

    const status = this.mangoService.determineCallStatus(payload);
    const duration = this.mangoService.calculateDuration(payload);
    const sipUsername = this.mangoService.extractSipUsername(to?.number || to);

    // Ищем номер телефона АТС (НЕ создаем автоматически)
    const phoneAts = to?.line_number || to?.number || to;
    const phone = await this.findPhone(phoneAts);

    // Ищем существующий звонок
    const existingCall = await this.prisma.call.findUnique({
      where: { callId: call_id },
    });

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
      const operator = await this.findOperatorBySip(sipUsername);
      
      call = await this.prisma.call.create({
        data: {
          rk: 'MANGO',
          city: operator?.city || '',
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

    const status = this.mangoService.determineCallStatus(payload);
    const duration = this.mangoService.calculateDuration(payload);
    const sipUsername = this.mangoService.extractSipUsername(to);
    const operator = await this.findOperatorBySip(sipUsername);

    // Ищем номер телефона АТС (НЕ создаем автоматически)
    const phoneAts = typeof to === 'object' ? (to?.line_number || to?.number || to) : to;
    const phoneClient = typeof from === 'object' ? (from?.number || from) : from;
    const phone = await this.findPhone(phoneAts);

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
          rk: 'MANGO',
          city: operator?.city || '',
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

  private async findPhone(phoneNumber: string): Promise<any> {
    // Если номер не указан, возвращаем null
    if (!phoneNumber || phoneNumber === 'undefined') {
      this.logger.warn('Phone number is undefined, skipping phone lookup');
      return null;
    }

    // Только ищем номер в базе, НЕ создаем автоматически
    const phone = await this.prisma.phone.findUnique({
      where: { number: phoneNumber },
    });

    if (!phone) {
      this.logger.warn(`⚠️ Phone number ${phoneNumber} not found in database. Call will be saved without phone relation. Please add this number manually if needed.`);
      return null;
    }

    return phone;
  }

  async processMangoRecording(payload: any) {
    try {
      // Парсим данные
      let recordingData = payload;
      if (payload.json) {
        recordingData = JSON.parse(payload.json);
      }

      const { entry_id, recording_id, recording_state } = recordingData;

      this.logger.log(`Recording webhook: entry_id=${entry_id}, recording_id=${recording_id}, state=${recording_state}`);

      // Обрабатываем только завершенные записи
      if (recording_state !== 'Completed') {
        return {
          success: true,
          message: `Recording not completed yet: ${recording_state}`,
        };
      }

      if (!entry_id || !recording_id) {
        return { success: false, message: 'Missing required fields' };
      }

      // Находим звонок по entry_id в mangoData
      const call = await this.prisma.call.findFirst({
        where: {
          OR: [
            // Поиск по entry_id в JSON поле (если используется)
            { callId: { contains: entry_id } },
            // Или если call_id совпадает
            { callId: entry_id },
          ],
        },
      });

      if (!call) {
        this.logger.warn(`Call not found for entry_id: ${entry_id}`);
        return {
          success: false,
          message: 'Call not found',
        };
      }

      this.logger.log(`Found call ID: ${call.id} for entry_id: ${entry_id}`);

      // TODO: Implement proper job queue (Bull/Redis) for delayed processing
      // For now, process asynchronously without blocking
      setImmediate(async () => {
        try {
          await this.processRecordingDownload(call, recording_id);
        } catch (error) {
          this.logger.error(`Async recording processing failed: ${error.message}`);
        }
      });

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



