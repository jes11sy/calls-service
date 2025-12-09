import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCallDto, UpdateCallDto } from './dto/call.dto';
import { InitiateCallbackDto } from './dto/initiate-callback.dto';
import { AuditLoggerService } from '../common/services/audit-logger.service';
import { MangoService } from '../mango/mango.service';

@Injectable()
export class CallsService {
  constructor(
    private prisma: PrismaService,
    private auditLogger: AuditLoggerService,
    private mangoService: MangoService,
  ) {}

  async getCalls(query: any, user: any) {
    const { status, operatorId, startDate, endDate, phone, city } = query;

    const where: any = {};

    if (status) {
      where.status = status;
    }

    if (operatorId) {
      where.operatorId = +operatorId;
    }

    if (city) {
      where.city = city;
    }

    if (phone) {
      where.phoneClient = { contains: phone };
    }

    if (startDate || endDate) {
      where.dateCreate = {};
      if (startDate) where.dateCreate.gte = new Date(startDate);
      if (endDate) where.dateCreate.lte = new Date(endDate);
    }

    // Pagination
    const page = query.page ? +query.page : 1;
    const limit = query.limit ? +query.limit : 20;
    const skip = (page - 1) * limit;

    // Get total count
    const total = await this.prisma.call.count({ where });

    const calls = await this.prisma.call.findMany({
      where,
      orderBy: { dateCreate: 'desc' },
      select: {
        id: true,
        rk: true,
        city: true,
        avitoName: true,
        phoneClient: true,
        phoneAts: true,
        dateCreate: true,
        status: true,
        callId: true,
        duration: true,
        recordUrl: true,
        recordingPath: true,
        recordingProcessedAt: true,
        recordingEmailSent: true,
        // mangoData: true, // Excluded by default (large JSON)
        createdAt: true,
        updatedAt: true,
        operator: {
          select: {
            id: true,
            name: true,
            login: true,
          },
        },
        phone: {
          select: {
            id: true,
            number: true,
            rk: true,
            city: true,
            avitoName: true,
          },
        },
        avito: {
          select: {
            id: true,
            name: true,
            connectionStatus: true,
          },
        },
      },
      skip,
      take: limit,
    });

    return {
      success: true,
      data: {
        calls,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      },
    };
  }

  async getCall(id: number) {
    const call = await this.prisma.call.findUnique({
      where: { id },
      select: {
        id: true,
        rk: true,
        city: true,
        avitoName: true,
        phoneClient: true,
        phoneAts: true,
        dateCreate: true,
        status: true,
        callId: true,
        duration: true,
        recordUrl: true,
        recordingPath: true,
        recordingProcessedAt: true,
        recordingEmailSent: true,
        // mangoData: true, // Excluded by default (large JSON)
        createdAt: true,
        updatedAt: true,
        operator: {
          select: {
            id: true,
            name: true,
            login: true,
            city: true,
            sipAddress: true,
          },
        },
        phone: {
          select: {
            id: true,
            number: true,
            rk: true,
            city: true,
            avitoName: true,
          },
        },
        avito: {
          select: {
            id: true,
            name: true,
            connectionStatus: true,
            isOnline: true,
          },
        },
      },
    });

    if (!call) {
      throw new NotFoundException('Call not found');
    }

    return {
      success: true,
      data: call,
    };
  }

  async createCall(dto: CreateCallDto, user: any) {
    const call = await this.prisma.call.create({
      data: {
        rk: dto.rk || 'MANUAL',
        city: dto.city || '',
        avitoName: dto.avitoName,
        callId: dto.callId || `MANUAL-${Date.now()}`,
        phoneClient: dto.phoneClient,
        phoneAts: dto.phoneAts || '',
        dateCreate: new Date(dto.dateCreate || Date.now()),
        duration: dto.duration,
        status: dto.status,
        recordUrl: dto.recordUrl,
        operatorId: user.userId,
      },
    });

    this.auditLogger.logCallCreated(call.id, user.userId, user.login, {
      phoneClient: dto.phoneClient,
      status: dto.status,
    });

    return {
      success: true,
      message: 'Call created successfully',
      data: call,
    };
  }

  async updateCall(id: number, dto: UpdateCallDto) {
    const call = await this.prisma.call.update({
      where: { id },
      data: {
        ...(dto.status && { status: dto.status }),
        ...(dto.duration !== undefined && { duration: dto.duration }),
        ...(dto.recordUrl && { recordUrl: dto.recordUrl }),
      },
    });

    this.auditLogger.logCallUpdated(call.id, undefined, undefined, {
      changes: dto,
    });

    return {
      success: true,
      message: 'Call updated successfully',
      data: call,
    };
  }

  async getCallsByPhone(phone: string) {
    const calls = await this.prisma.call.findMany({
      where: {
        phoneClient: { contains: phone },
      },
      orderBy: { dateCreate: 'desc' },
      select: {
        id: true,
        rk: true,
        city: true,
        avitoName: true,
        phoneClient: true,
        phoneAts: true,
        dateCreate: true,
        status: true,
        callId: true,
        duration: true,
        recordUrl: true,
        recordingPath: true,
        recordingProcessedAt: true,
        recordingEmailSent: true,
        // mangoData: true, // Excluded by default (large JSON)
        createdAt: true,
        updatedAt: true,
        operator: {
          select: {
            id: true,
            name: true,
            login: true,
            city: true,
            sipAddress: true,
          },
        },
        phone: {
          select: {
            id: true,
            number: true,
            rk: true,
            city: true,
            avitoName: true,
          },
        },
        avito: {
          select: {
            id: true,
            name: true,
            connectionStatus: true,
            isOnline: true,
          },
        },
      },
      take: 50,
    });

    return {
      success: true,
      data: calls,
    };
  }

  async getCallStats(query: any) {
    const { startDate, endDate, city } = query;

    const where: any = {};

    if (city) {
      where.city = city;
    }

    if (startDate || endDate) {
      where.dateCreate = {};
      if (startDate) where.dateCreate.gte = new Date(startDate);
      if (endDate) where.dateCreate.lte = new Date(endDate);
    }

    const [totalCalls, answeredCalls, missedCalls, totalDuration] = await Promise.all([
      this.prisma.call.count({ where }),
      this.prisma.call.count({ where: { ...where, status: 'answered' } }),
      this.prisma.call.count({ where: { ...where, status: 'missed' } }),
      this.prisma.call.aggregate({
        where: { ...where, status: 'answered' },
        _sum: { duration: true },
      }),
    ]);

    return {
      success: true,
      data: {
        totalCalls,
        answeredCalls,
        missedCalls,
        totalDuration: totalDuration._sum.duration || 0,
        avgDuration: answeredCalls > 0 ? Math.round((totalDuration._sum.duration || 0) / answeredCalls) : 0,
      },
    };
  }

  async updateMultipleCalls(callIds: number[], data: Partial<UpdateCallDto>) {
    const updated = await this.prisma.call.updateMany({
      where: {
        id: { in: callIds },
      },
      data: {
        ...(data.status && { status: data.status }),
        ...(data.duration !== undefined && { duration: data.duration }),
        ...(data.recordUrl && { recordUrl: data.recordUrl }),
      },
    });

    this.auditLogger.log({
      action: 'CALLS_BATCH_UPDATED',
      resourceType: 'call',
      metadata: { callIds, count: updated.count, changes: data },
    });

    return {
      success: true,
      message: `Updated ${updated.count} calls`,
      data: { count: updated.count },
    };
  }

  async getCallsByOrderId(orderId: number) {
    // Получаем заказ
    const order = await this.prisma.order.findUnique({
      where: { id: orderId }
    });

    if (!order) {
      throw new NotFoundException('Заказ не найден');
    }

    let calls = [];

    if (order.callId) {
      // Парсим массив ID из строки (например: "145,182,215")
      const callIds = order.callId.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
      
      if (callIds.length > 0) {
        // Ищем звонки по массиву ID и фильтруем только те, у которых есть запись
        calls = await this.prisma.call.findMany({
          where: {
            id: {
              in: callIds
            },
            recordingPath: {
              not: null // Только звонки с записями
            }
          },
          select: {
            id: true,
            rk: true,
            city: true,
            phoneClient: true,
            phoneAts: true,
            dateCreate: true,
            status: true,
            callId: true,
            duration: true,
            recordUrl: true,
            recordingPath: true,
            createdAt: true,
            updatedAt: true,
            operator: {
              select: {
                id: true,
                name: true,
                login: true
              }
            }
          },
          orderBy: {
            dateCreate: 'desc'
          }
        });
      }
    }

    // Добавляем recordingUrl для совместимости с фронтендом
    const callsWithRecordingUrl = calls.map(call => ({
      ...call,
      recordingUrl: call.recordingPath || call.recordUrl
    }));

    return {
      success: true,
      data: callsWithRecordingUrl
    };
  }

  /**
   * Инициирует callback звонок мастеру с последующим соединением с клиентом
   */
  async initiateCallback(dto: InitiateCallbackDto, user: any) {
    try {
      // 1. Получаем заказ напрямую из БД (та же БД, что и у orders-service)
      const order = await this.prisma.order.findUnique({
        where: { id: dto.orderId },
        select: {
          id: true,
          phone: true,
          clientName: true,
          rk: true,
          city: true,
          callId: true,
        },
      });

      if (!order) {
        throw new NotFoundException('Заказ не найден');
      }

      if (!order.phone) {
        throw new BadRequestException('У заказа отсутствует номер телефона клиента');
      }

      // 2. Определяем phoneAts с fallback стратегией
      let phoneAts: string | null = null;
      let callSource = '';

      // Приоритет 1: Если у заказа есть callId - используем звонок из заказа
      if (order.callId) {
        const orderCall = await this.prisma.call.findUnique({
          where: { callId: order.callId },
          select: { phoneAts: true },
        });
        if (orderCall?.phoneAts) {
          phoneAts = orderCall.phoneAts;
          callSource = 'order_call';
        }
      }

      // Приоритет 2: Ищем последний звонок от этого номера
      if (!phoneAts) {
        const lastCall = await this.prisma.call.findFirst({
          where: { phoneClient: order.phone },
          orderBy: { dateCreate: 'desc' },
          select: { phoneAts: true },
        });
        if (lastCall?.phoneAts) {
          phoneAts = lastCall.phoneAts;
          callSource = 'client_history';
        }
      }

      // Приоритет 3: Берём дефолтный номер для города и РК из таблицы phones
      if (!phoneAts) {
        const defaultPhone = await this.prisma.phone.findFirst({
          where: {
            city: order.city,
            rk: order.rk,
          },
          select: { number: true },
        });
        if (defaultPhone?.number) {
          phoneAts = defaultPhone.number;
          callSource = 'default_city_rk';
        }
      }

      // Если вообще ничего не нашли - ошибка
      if (!phoneAts) {
        throw new BadRequestException(
          `Не найден номер АТС для звонка. Клиент не звонил, и нет дефолтного номера для города "${order.city}" и РК "${order.rk}".`
        );
      }

      // 3. Инициируем callback через Mango Office
      const commandId = `callback_${dto.orderId}_${Date.now()}`;
      
      const mangoResult = await this.mangoService.initiateCallback({
        from: phoneAts,                  // Номер АТС (отобразится у клиента)
        to_number: order.phone,          // Номер клиента
        sip_id: dto.masterPhone,         // Номер мастера
        command_id: commandId,
      });

      // 4. Логируем успешную инициацию
      await this.auditLogger.log({
        action: 'INITIATE_CALLBACK',
        userId: user.id,
        userLogin: user.login,
        resourceType: 'callback',
        metadata: {
          userRole: user.role,
          orderId: dto.orderId,
          masterPhone: dto.masterPhone,
          clientPhone: order.phone,
          phoneAts: phoneAts,
          callSource: callSource, // Откуда взяли номер
          commandId,
          mangoCallId: mangoResult.call_id,
        },
      });

      return {
        success: true,
        message: 'Звонок инициирован. Ожидайте входящего звонка на ваш номер.',
        data: {
          commandId,
          mangoCallId: mangoResult.call_id,
          clientPhone: order.phone,
          clientName: order.clientName,
          phoneAts: phoneAts,
          callSource: callSource, // Для отладки
        },
      };
    } catch (error) {
      // Логируем ошибку
      await this.auditLogger.log({
        action: 'INITIATE_CALLBACK_ERROR',
        userId: user.id,
        userLogin: user.login,
        resourceType: 'callback',
        metadata: {
          userRole: user.role,
          orderId: dto.orderId,
          error: error.message,
        },
      });

      // Пробрасываем ошибку дальше
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }

      throw new BadRequestException(
        `Не удалось инициировать звонок: ${error.message}`
      );
    }
  }
}




