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

      // Для callback игнорируем первую "ногу" (звонок системы к мастеру)
      // Первая нога определяется по наличию to.extension (внутренний номер мастера)
      // Записываем только вторую ногу - когда мастер соединяется с клиентом
      if (isCallback && to?.extension) {
        this.logger.log(`Ignoring callback first leg (to master): ${call_id}, extension: ${to.extension}`);
        return { success: true, message: 'Callback first leg ignored' };
      }

      // Игнорируем "дозвоны" после callback - входящие звонки от того же клиента
      // в течение 30 секунд после callback на тот же номер АТС
      if (callDirection === 'inbound') {
        const phoneClient = from?.number || from;
        const phoneAts = to?.line_number || from?.line_number;
        
        if (phoneClient && phoneAts) {
          const thirtySecondsAgo = new Date(Date.now() - 30000);
          const recentCallback = await this.prisma.call.findFirst({
            where: {
              phoneClient,
              phoneAts,
              callDirection: 'callback',
              createdAt: { gte: thirtySecondsAgo },
            },
            orderBy: { createdAt: 'desc' },
          });
          
          if (recentCallback) {
            this.logger.log(`Ignoring post-callback followup from ${phoneClient} to ${phoneAts} (recent callback: ${recentCallback.id})`);
            return { success: true, message: 'Post-callback followup ignored' };
          }
        }
      }

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

      // Сначала ищем существующий звонок - он мог быть создан в Disconnected с callDirection='callback'
      const existingCallForDirection = await this.prisma.call.findFirst({
        where: {
          OR: [
            { callId: entry_id },
            {
              mangoData: {
                path: ['entry_id'],
                equals: entry_id,
              },
            },
          ],
        },
      });

      // Определяем направление звонка
      // Приоритет: существующий звонок > command_id > call_direction от Mango
      let isCallback = command_id && command_id.startsWith('callback_');
      if (!isCallback && existingCallForDirection?.callDirection === 'callback') {
        isCallback = true;
        this.logger.log(`Detected callback from existing call: ${existingCallForDirection.id}`);
      }
      
      // call_direction: 1 = входящий, 2 = исходящий
      const isOutbound = call_direction === 2;
      const callDirectionType = isCallback ? 'callback' : (isOutbound ? 'outbound' : 'inbound');
      
      this.logger.log(`Processing ${callDirectionType} call: ${entry_id}`);

      // Игнорируем "дозвоны" после callback - входящие звонки от того же клиента
      // в течение 30 секунд после callback на тот же номер АТС
      if (callDirectionType === 'inbound' && !existingCallForDirection) {
        const phoneClient = from?.number || from;
        const phoneAts = line_number || to?.line_number || from?.line_number;
        
        if (phoneClient && phoneAts) {
          const thirtySecondsAgo = new Date(Date.now() - 30000);
          const recentCallback = await this.prisma.call.findFirst({
            where: {
              phoneClient,
              phoneAts,
              callDirection: 'callback',
              createdAt: { gte: thirtySecondsAgo },
            },
            orderBy: { createdAt: 'desc' },
          });
          
          if (recentCallback) {
            this.logger.log(`Ignoring post-callback followup summary from ${phoneClient} to ${phoneAts} (recent callback: ${recentCallback.id})`);
            return { success: true, message: 'Post-callback followup ignored' };
          }
        }
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

      // Определяем номера в зависимости от направления звонка
      // Для исходящих (call_direction=2): оператор в from, клиент в to
      // Для входящих (call_direction=1): клиент в from, оператор в to
      const phoneAts = line_number || to?.line_number || from?.line_number;
      const phoneClient = isOutbound ? (to?.number || to) : (from?.number || from);

      let operator;
      let phone;
      let masterId: number | null = null;

      if (isCallback) {
        // Для callback-звонков используем оператора "Система" (ID = 1)
        // И пытаемся получить masterId из существующего звонка или из command_id
        const [phoneResult, systemOperator] = await Promise.all([
          this.prisma.phone.findUnique({ where: { number: phoneAts } }),
          this.prisma.callcentreOperator.findUnique({ where: { id: 1 } }),
        ]);
        phone = phoneResult;
        operator = systemOperator;
        
        // Берём masterId из существующего звонка или пытаемся получить из command_id
        if (existingCallForDirection?.masterId) {
          masterId = existingCallForDirection.masterId;
        } else if (command_id) {
          masterId = await this.getMasterIdFromCommandId(command_id);
        } else {
          // Пытаемся получить command_id из mangoData существующего звонка (может быть от Connected/Disconnected)
          const savedCommandId = (existingCallForDirection?.mangoData as any)?.command_id;
          if (savedCommandId) {
            masterId = await this.getMasterIdFromCommandId(savedCommandId);
            this.logger.log(`Got masterId from saved mangoData command_id: ${savedCommandId}`);
          }
        }
        
        this.logger.log(`Callback call - using System operator (ID: 1), masterId: ${masterId}`);
      } else {
        // Определяем откуда брать SIP-адрес оператора
        // Для исходящих: оператор в from.number (sip:...)
        // Для входящих: оператор в to.number (sip:...)
        const operatorSipSource = isOutbound ? (from?.number || from) : (to?.number || to);
        const sipUsername = this.mangoService.extractSipUsername(operatorSipSource);
        
        this.logger.log(`Looking for operator by SIP: ${sipUsername} (source: ${isOutbound ? 'from' : 'to'})`);
        
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

      // Используем ранее найденный звонок или ищем дополнительно по номерам
      let existingCall = existingCallForDirection;
      
      if (!existingCall) {
        // Дополнительный поиск по номерам и времени
        existingCall = await this.prisma.call.findFirst({
          where: {
            phoneClient,
            phoneAts,
            operatorId: operator.id,
            createdAt: {
              gte: new Date((create_time - 10) * 1000), // ±10 секунд
              lte: new Date((create_time + 10) * 1000),
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
        });
      }

      let call;
      let isNewCall = false;
      
      if (existingCall) {
        // Обновляем существующий звонок
        call = await this.prisma.call.update({
          where: { id: existingCall.id },
          data: {
            callId: entry_id, // Обновляем callId на entry_id из Summary
            callDirection: callDirectionType, // inbound | outbound | callback
            status,
            duration,
            phoneClient,
            phoneAts,
            avitoName: phone?.avitoName || null, // Берем avitoName из phone
            mangoData: summaryData,
            ...(masterId && { masterId }), // Добавляем masterId только если есть
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
        
        this.logger.log(`Updated existing call: ${existingCall.id}, callId: ${entry_id}, direction: ${callDirectionType}, masterId: ${masterId}, avitoName: ${phone?.avitoName || 'null'}`);
      } else {
        isNewCall = true;
        // Создаем новый звонок (с обработкой race condition)
        try {
          call = await this.prisma.call.create({
            data: {
              rk,
              city,
              callDirection: callDirectionType, // inbound | outbound | callback
              callId: entry_id,
              phoneClient,
              phoneAts,
              avitoName: phone?.avitoName || null, // Берем avitoName из phone
              status,
              duration,
              operatorId: operator.id,
              mangoData: summaryData,
              ...(masterId && { masterId }), // Добавляем masterId только если есть
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
        } catch (createError: any) {
          // Обработка race condition - если запись уже создана другим событием
          if (createError.code === 'P2002') {
            this.logger.log(`Race condition detected, call already exists with callId: ${entry_id}`);
            // Повторно ищем и обновляем
            const existingByCallId = await this.prisma.call.findUnique({
              where: { callId: entry_id },
            });
            if (existingByCallId) {
              call = await this.prisma.call.update({
                where: { id: existingByCallId.id },
                data: {
                  callDirection: callDirectionType,
                  status,
                  duration,
                  avitoName: phone?.avitoName || null,
                  mangoData: summaryData,
                  ...(masterId && { masterId }),
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
              isNewCall = false;
              this.logger.log(`Updated call after race condition: ${call.id}`);
            } else {
              throw createError;
            }
          } else {
            throw createError;
          }
        }
      }

      // Broadcast в зависимости от того, новый звонок или обновленный
      if (isNewCall) {
        // Broadcast нового звонка
        await this.realtimeService.broadcastNewCall(call, [
          'operators',
          `operator:${operator.id}`,
        ]);
        this.logger.log(`Broadcasted new call: ${call.id}`);
        
        // ✅ UI уведомление оператору о входящем звонке
        this.logger.log(`Checking UI notification: callDirection=${callDirectionType}, operatorId=${operator.id}`);
        if (callDirectionType === 'inbound' && operator.id) {
          this.logger.log(`Sending UI notification to operator ${operator.id} for call ${call.id}`);
          this.realtimeService.sendCallNotificationToOperator(
            operator.id,
            call.id,
            phoneClient,
            callDirectionType,
            city,
            phone?.avitoName,
          ).then(() => {
            this.logger.log(`UI notification sent successfully for call ${call.id}`);
          }).catch(err => this.logger.warn(`UI notification failed: ${err.message}`));
        }
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

    const phoneAts = to?.line_number || to?.number || to;
    const phoneClient = from?.number || from;

    // Проверяем, существует ли звонок
    const existingCall = await this.prisma.call.findUnique({
      where: { callId: call_id },
    });

    // Ищем phone для получения avitoName и города
    const phone = await this.prisma.phone.findUnique({
      where: { number: phoneAts },
    });

    // Находим оператора по SIP
    const operatorSipSource = to?.number || to;
    const sipUsername = this.mangoService.extractSipUsername(operatorSipSource);
    const operator = await this.findOperatorBySip(sipUsername);

    if (existingCall) {
      // Обновляем данные
      await this.prisma.call.update({
        where: { callId: call_id },
        data: {
          phoneClient: phoneClient,
          phoneAts: phoneAts,
          avitoName: phone?.avitoName || null,
        },
      });
    }

    // ✅ UI уведомление оператору о входящем звонке (когда начинает звонить)
    if (callDirection === 'inbound' && operator?.id) {
      const city = phone?.city || operator?.city || 'Не указан';
      this.logger.log(`Sending UI notification (appeared) to operator ${operator.id}`);
      this.realtimeService.sendCallNotificationToOperator(
        operator.id,
        0, // call.id ещё не известен
        phoneClient,
        'inbound',
        city,
        phone?.avitoName,
      ).then(() => {
        this.logger.log(`UI notification (appeared) sent successfully`);
      }).catch(err => this.logger.warn(`UI notification (appeared) failed: ${err.message}`));
    }

    return {
      success: true,
      message: 'Call appeared',
    };
  }

  private async handleCallConnected(payload: any, callDirection: string = 'inbound') {
    const { call_id, from, to, answer_time, create_time, timestamp, command_id, entry_id } = payload;

    if (!call_id) {
      this.logger.warn('Call ID is missing in Connected event');
      return { success: true, message: 'Call ID missing' };
    }

    this.logger.log(`Call connected: ${call_id}, direction: ${callDirection}`);

    const isCallback = callDirection === 'callback';
    const isOutbound = callDirection === 'outbound';
    
    // Определяем номер АТС (линии)
    const phoneAts = to?.line_number || from?.line_number || to?.number || to;
    // Для исходящих: клиент в to, для входящих: клиент в from
    const phoneClient = isOutbound ? (to?.number || to) : (from?.number || from);

    // Используем entry_id как callId если есть (для связи с Summary), иначе call_id
    const primaryCallId = entry_id || call_id;

    // Ищем существующий звонок по call_id ИЛИ entry_id (для дедупликации)
    const findExistingCall = async () => {
      let call = await this.prisma.call.findUnique({ where: { callId: call_id } });
      if (call) return call;
      
      if (entry_id) {
        call = await this.prisma.call.findFirst({
          where: {
            OR: [
              { callId: entry_id },
              { mangoData: { path: ['entry_id'], equals: entry_id } },
            ],
          },
        });
      }
      return call;
    };

    let operator;
    let phone;
    let existingCall;

    if (isCallback) {
      // Для callback-звонков используем оператора "Система" (ID = 1)
      const [phoneResult, systemOperator, call] = await Promise.all([
        this.prisma.phone.findUnique({ where: { number: phoneAts } }),
        this.prisma.callcentreOperator.findUnique({ where: { id: 1 } }),
        findExistingCall(),
      ]);
      phone = phoneResult;
      operator = systemOperator;
      existingCall = call;
    } else {
      // Определяем откуда брать SIP-адрес оператора
      // Для исходящих: оператор в from.number (sip:...)
      // Для входящих: оператор в to.number (sip:...)
      const operatorSipSource = isOutbound ? (from?.number || from) : (to?.number || to);
      const sipUsername = this.mangoService.extractSipUsername(operatorSipSource);
      
      this.logger.log(`Looking for operator by SIP: ${sipUsername} (source: ${isOutbound ? 'from' : 'to'})`);
      
      const [foundOperator, phoneResult, call] = await Promise.all([
        this.findOperatorBySip(sipUsername),
        this.prisma.phone.findUnique({ where: { number: phoneAts } }),
        findExistingCall(),
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

    let call;
    if (existingCall) {
      // Обновляем статус на answered
      call = await this.prisma.call.update({
        where: { id: existingCall.id },
        data: {
          callId: primaryCallId, // Обновляем на entry_id для связи с Summary
          callDirection, // inbound | outbound | callback
          status: 'answered',
          operatorId: operator.id,
          avitoName: phone?.avitoName || null,
          mangoData: payload,
        },
      });
      this.logger.log(`Updated call ${existingCall.id} to answered, callId: ${primaryCallId}`);
    } else {
      // Создаем новый звонок
      call = await this.prisma.call.create({
        data: {
          rk,
          city,
          callDirection, // inbound | outbound | callback
          callId: primaryCallId,
          phoneClient,
          phoneAts: phoneAts,
          avitoName: phone?.avitoName || null,
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
      this.logger.log(`Created new call ${call.id}, callId: ${primaryCallId}`);

      // Broadcast нового звонка
      await this.realtimeService.broadcastNewCall(call, [
        'operators',
        `operator:${operator.id}`,
      ]);
      
      // ✅ UI уведомление оператору о входящем звонке
      if (callDirection === 'inbound' && operator.id) {
        this.realtimeService.sendCallNotificationToOperator(
          operator.id,
          call.id,
          phoneClient,
          callDirection as 'inbound' | 'outbound' | 'callback',
          city,
          phone?.avitoName,
        ).catch(err => this.logger.warn(`UI notification failed: ${err.message}`));
      }
    }

    return {
      success: true,
      message: 'Call connected',
      data: { callId: primaryCallId },
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
    const isOutbound = callDirection === 'outbound';
    
    // Определяем номер АТС (линии)
    const phoneAts = to?.line_number || from?.line_number || to?.number || to;
    // Для исходящих: клиент в to, для входящих: клиент в from
    const phoneClient = isOutbound ? (to?.number || to) : (from?.number || from);

    let operator;
    let phone;
    let existingCall;
    let masterId: number | null = null;

    // Ищем существующий звонок по call_id ИЛИ entry_id (для дедупликации)
    const findExistingCall = async () => {
      // Сначала по call_id
      let call = await this.prisma.call.findUnique({ where: { callId: call_id } });
      if (call) return call;
      
      // Потом по entry_id (если есть)
      if (entry_id) {
        call = await this.prisma.call.findFirst({
          where: {
            OR: [
              { callId: entry_id },
              { mangoData: { path: ['entry_id'], equals: entry_id } },
            ],
          },
        });
      }
      return call;
    };

    if (isCallback) {
      // Для callback-звонков используем оператора "Система" (ID = 1)
      const [phoneResult, systemOperator, call] = await Promise.all([
        this.prisma.phone.findUnique({ where: { number: phoneAts } }),
        this.prisma.callcentreOperator.findUnique({ where: { id: 1 } }),
        findExistingCall(),
      ]);
      phone = phoneResult;
      operator = systemOperator;
      existingCall = call;
      
      // Получаем masterId из command_id
      if (command_id) {
        masterId = await this.getMasterIdFromCommandId(command_id);
        this.logger.log(`Callback disconnected - masterId: ${masterId} from command_id: ${command_id}`);
      }
    } else {
      // Определяем откуда брать SIP-адрес оператора
      // Для исходящих: оператор в from.number (sip:...)
      // Для входящих: оператор в to.number (sip:...)
      const operatorSipSource = isOutbound ? (from?.number || from) : (to?.number || to);
      const sipUsername = this.mangoService.extractSipUsername(operatorSipSource);
      
      this.logger.log(`Looking for operator by SIP: ${sipUsername} (source: ${isOutbound ? 'from' : 'to'})`);
      
      const [foundOperator, phoneResult, call] = await Promise.all([
        this.findOperatorBySip(sipUsername),
        this.prisma.phone.findUnique({ where: { number: phoneAts } }),
        findExistingCall(),
      ]);
      operator = foundOperator;
      phone = phoneResult;
      existingCall = call;
    }
    
    // Определяем город и РК из phone или operator
    const city = phone?.city || operator?.city || 'Неизвестно';
    const rk = phone?.rk || 'Уточнить';

    // Используем entry_id как callId если есть (для связи с Summary), иначе call_id
    const primaryCallId = entry_id || call_id;

    let call;
    if (existingCall) {
      // Обновляем финальными данными
      call = await this.prisma.call.update({
        where: { id: existingCall.id },
        data: {
          callId: primaryCallId, // Обновляем callId на entry_id для связи с Summary
          callDirection, // inbound | outbound | callback
          status,
          duration,
          avitoName: phone?.avitoName || null,
          mangoData: payload,
          ...(masterId && { masterId }), // Добавляем masterId только если есть
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
      this.logger.log(`Updated call ${existingCall.id} with callId: ${primaryCallId}`);
    } else {
      // Создаем звонок при завершении (если не был создан раньше)
      try {
        call = await this.prisma.call.create({
          data: {
            rk,
            city,
            callDirection, // inbound | outbound | callback
            callId: primaryCallId, // Используем entry_id для связи с Summary
            phoneClient,
            phoneAts: phoneAts,
            avitoName: phone?.avitoName || null,
            status,
            duration,
            operatorId: operator?.id || 1, // Fallback to operator 1
            mangoData: payload,
            ...(masterId && { masterId }), // Добавляем masterId только если есть
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
        this.logger.log(`Created new call ${call.id} with callId: ${primaryCallId}`);

        // Broadcast нового звонка
        await this.realtimeService.broadcastNewCall(call, ['operators']);
      } catch (createError: any) {
        // Обработка race condition - если запись уже создана другим событием
        if (createError.code === 'P2002') {
          this.logger.log(`Race condition in Disconnected, call already exists with callId: ${primaryCallId}`);
          // Повторно ищем и обновляем
          const existingByCallId = await this.prisma.call.findUnique({
            where: { callId: primaryCallId },
          });
          if (existingByCallId) {
            call = await this.prisma.call.update({
              where: { id: existingByCallId.id },
              data: {
                callDirection,
                status,
                duration,
                avitoName: phone?.avitoName || null,
                mangoData: payload,
                ...(masterId && { masterId }),
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
            this.logger.log(`Updated call after race condition: ${call.id}`);
          } else {
            throw createError;
          }
        } else {
          throw createError;
        }
      }
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
    const isOutbound = callDirection === 'outbound';

    // Определяем номер АТС (линии)
    const phoneAts = typeof to === 'object' 
      ? (to?.line_number || from?.line_number || to?.number) 
      : (typeof from === 'object' ? from?.line_number : to);
    
    // Для исходящих: клиент в to, для входящих: клиент в from
    const phoneClient = isOutbound 
      ? (typeof to === 'object' ? (to?.number || to) : to)
      : (typeof from === 'object' ? (from?.number || from) : from);
    
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
      // Определяем откуда брать SIP-адрес оператора
      const operatorSipSource = isOutbound 
        ? (typeof from === 'object' ? (from?.number || from) : from)
        : (typeof to === 'object' ? (to?.number || to) : to);
      const sipUsername = this.mangoService.extractSipUsername(operatorSipSource);
      
      this.logger.log(`Legacy format - looking for operator by SIP: ${sipUsername}`);
      
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
          callDirection, // inbound | outbound | callback
          status,
          duration,
          phoneAts,
          avitoName: phone?.avitoName || null,
          mangoData: payload,
        },
      });
    } else {
      call = await this.prisma.call.create({
        data: {
          rk,
          city,
          callDirection, // inbound | outbound | callback
          callId: call_id,
          phoneClient,
          phoneAts,
          avitoName: phone?.avitoName || null,
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
      // Если это обычный телефонный номер (не SIP), сразу возвращаем null
      // Телефонные номера обычно 10-11 цифр и начинаются с 7 или 8
      const cleanNumber = sipUsername?.replace(/\D/g, '');
      if (cleanNumber && cleanNumber.length >= 10 && (cleanNumber.startsWith('7') || cleanNumber.startsWith('8'))) {
        this.logger.warn(`Skipping phone number lookup as SIP: ${sipUsername} (this is a phone number, not SIP)`);
        return null;
      }

      if (!sipUsername || sipUsername === 'undefined') {
        this.logger.warn('SIP username is empty or undefined');
        return null;
      }

      // Ищем оператора по SIP-адресу (точное совпадение)
      let operator = await this.prisma.callcentreOperator.findFirst({
        where: { sipAddress: sipUsername },
      });

      // Если не нашли, попробуем найти по частичному совпадению
      // Например, в базе "krekotneva", а в вебхуке приходит "krekotneva@vpbx..."
      if (!operator && sipUsername.includes('@')) {
        const localPart = sipUsername.split('@')[0];
        operator = await this.prisma.callcentreOperator.findFirst({
          where: { sipAddress: localPart },
        });
      }

      if (operator) {
        this.logger.log(`Found operator by SIP: ${operator.name} (${operator.id})`);
        return operator;
      }

      // Не нашли — возвращаем null (не используем fallback для обычных звонков)
      this.logger.warn(`Operator not found for SIP: ${sipUsername}`);
      return null;
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
   * Получает masterId из command_id для callback-звонков
   * command_id имеет формат: callback_orderId_timestamp
   * Пример: callback_2002_1770240175394
   */
  private async getMasterIdFromCommandId(commandId: string): Promise<number | null> {
    try {
      if (!commandId || !commandId.startsWith('callback_')) {
        return null;
      }

      // Парсим orderId из command_id: callback_2002_1770240175394
      const parts = commandId.split('_');
      if (parts.length < 2) {
        this.logger.warn(`Invalid command_id format: ${commandId}`);
        return null;
      }

      const orderId = parseInt(parts[1], 10);
      if (isNaN(orderId)) {
        this.logger.warn(`Cannot parse orderId from command_id: ${commandId}`);
        return null;
      }

      // Получаем masterId из заказа напрямую из БД
      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        select: { masterId: true },
      });

      if (!order) {
        this.logger.warn(`Order not found: ${orderId}`);
        return null;
      }

      this.logger.log(`Found masterId: ${order.masterId} for orderId: ${orderId} from command_id: ${commandId}`);
      return order.masterId;
    } catch (error) {
      this.logger.error(`Error getting masterId from command_id: ${error.message}`);
      return null;
    }
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



