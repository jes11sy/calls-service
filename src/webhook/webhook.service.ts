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

  private async handleCallAppeared(payload: any) {
    const { call_id, from, to, create_time, timestamp } = payload;

    this.logger.log(`Call appeared: ${call_id}`);

    // Проверяем, существует ли звонок
    const existingCall = await this.prisma.call.findUnique({
      where: { callId: call_id },
    });

    if (existingCall) {
      // Обновляем данные
      await this.prisma.call.update({
        where: { callId: call_id },
        data: {
          phoneClient: from?.number || from,
          phoneAts: to?.number || to,
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

    this.logger.log(`Call connected: ${call_id}`);

    const sipUsername = this.mangoService.extractSipUsername(to?.number || to);
    const operator = await this.findOperatorBySip(sipUsername);

    if (!operator) {
      this.logger.warn(`Operator not found for SIP: ${sipUsername}`);
      return { success: true, message: 'Operator not found' };
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
        },
      });
    } else {
      // Создаем новый звонок
      call = await this.prisma.call.create({
        data: {
          rk: 'MANGO',
          city: operator.city || '',
          callId: call_id,
          phoneClient: from?.number || from,
          phoneAts: to?.number || to,
          dateCreate: new Date(create_time || answer_time || timestamp * 1000),
          status: 'answered',
          operatorId: operator.id,
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

    this.logger.log(`Call disconnected: ${call_id}, reason: ${disconnect_reason}`);

    const status = this.mangoService.determineCallStatus(payload);
    const duration = this.mangoService.calculateDuration(payload);
    const sipUsername = this.mangoService.extractSipUsername(to?.number || to);

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
          phoneAts: to?.number || to,
          dateCreate: new Date(create_time || timestamp * 1000),
          status,
          duration,
          operatorId: operator?.id || 1, // Fallback to operator 1
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
          phoneAts: to,
          dateCreate: new Date(create_time || timestamp * 1000),
        },
      });
    } else {
      call = await this.prisma.call.create({
        data: {
          rk: 'MANGO',
          city: operator?.city || '',
          callId: call_id,
          phoneClient: from,
          phoneAts: to,
          dateCreate: new Date(create_time || timestamp * 1000),
          duration,
          status,
          operatorId: operator?.id || 1,
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

      // Ждем 5 секунд (Mango обрабатывает файл)
      this.logger.log('Waiting 5 seconds for Mango to process recording...');
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Скачиваем запись
      if (this.mangoService.isConfigured()) {
        try {
          const buffer = await this.mangoService.downloadRecording(recording_id);
          
          // Загружаем в S3 если настроено
          if (this.s3Service.isConfigured()) {
            const filename = `${call.callId}_${Date.now()}.mp3`;
            const s3Key = await this.s3Service.uploadRecording(filename, buffer);
            
            // Обновляем звонок
            await this.prisma.call.update({
              where: { id: call.id },
              data: {
                recordUrl: `s3://${s3Key}`,
              },
            });

            this.logger.log(`Recording uploaded to S3: ${s3Key}`);

            // Broadcast обновления
            await this.realtimeService.broadcastCallUpdated(
              { ...call, recordUrl: `s3://${s3Key}` },
              ['operators'],
            );

            return {
              success: true,
              message: 'Recording processed and uploaded',
              data: { callId: call.callId, s3Key },
            };
          } else {
            this.logger.warn('S3 not configured - recording not uploaded');
            return {
              success: true,
              message: 'Recording downloaded but S3 not configured',
            };
          }
        } catch (error) {
          this.logger.error(`Error processing recording: ${error.message}`);
          return {
            success: false,
            message: `Error processing recording: ${error.message}`,
          };
        }
      } else {
        this.logger.warn('Mango API not configured - cannot download recording');
        return {
          success: false,
          message: 'Mango API not configured',
        };
      }
    } catch (error) {
      this.logger.error(`Error in processMangoRecording: ${error.message}`, error.stack);
      return {
        success: false,
        message: error.message,
      };
    }
  }
}



