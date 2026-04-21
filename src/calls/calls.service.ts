import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCallDto, UpdateCallDto } from './dto/call.dto';
import { InitiateCallbackDto } from './dto/initiate-callback.dto';
import { AuditLoggerService } from '../common/services/audit-logger.service';
import { MangoService } from '../mango/mango.service';
import { RealtimeService } from '../realtime/realtime.service';

@Injectable()
export class CallsService {
  constructor(
    private prisma: PrismaService,
    private auditLogger: AuditLoggerService,
    private mangoService: MangoService,
    private realtimeService: RealtimeService,
  ) {}

  async getCalls(query: any, user: any) {
    const { status, operatorId, startDate, endDate, phone, cityId, rkId } = query;

    const where: any = {};

    if (user.role === 'operator') {
      where.operatorId = { in: [user.userId, 1] };
    } else if (operatorId) {
      where.operatorId = +operatorId;
    }

    if (status) where.status = status;
    if (cityId) where.cityId = +cityId;
    if (rkId) where.rkId = +rkId;
    if (phone) where.phoneClient = { contains: phone };

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const page = query.page ? +query.page : 1;
    const limit = query.limit ? +query.limit : 20;
    const skip = (page - 1) * limit;

    const total = await this.prisma.call.count({ where });

    const calls = await this.prisma.call.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        cityId: true,
        city: { select: { id: true, name: true } },
        rkId: true,
        rk: { select: { id: true, name: true, code: true } },
        callDirection: true,
        phoneClient: true,
        phoneAts: true,
        masterId: true,
        directorId: true,
        note: true,
        appealId: true,
        status: true,
        callId: true,
        duration: true,
        recordingPath: true,
        recordingProcessedAt: true,
        createdAt: true,
        updatedAt: true,
        operator: {
          select: { id: true, name: true, login: true },
        },
        appeal: {
          select: { id: true, sourceType: true, orderId: true },
        },
        master: {
          select: { id: true, name: true },
        },
      },
      skip,
      take: limit,
    });

    const callsWithMasterName = calls.map((call: any) => ({
      ...call,
      orderId: call.appeal?.orderId ?? null,
      source: call.appeal?.sourceType ?? null,
      masterName: call.master?.name || null,
    }));

    return {
      success: true,
      data: {
        calls: callsWithMasterName,
        pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
      },
    };
  }

  async getCall(id: number) {
    const call = await this.prisma.call.findUnique({
      where: { id },
      select: {
        id: true,
        cityId: true,
        city: { select: { id: true, name: true } },
        rkId: true,
        rk: { select: { id: true, name: true, code: true } },
        callDirection: true,
        phoneClient: true,
        phoneAts: true,
        masterId: true,
        directorId: true,
        note: true,
        appealId: true,
        status: true,
        callId: true,
        duration: true,
        recordingPath: true,
        recordingProcessedAt: true,
        createdAt: true,
        updatedAt: true,
        operator: {
          select: { id: true, name: true, login: true, sipAddress: true },
        },
        appeal: {
          select: { id: true, sourceType: true, orderId: true },
        },
        master: {
          select: { id: true, name: true },
        },
      },
    });

    if (!call) throw new NotFoundException('Call not found');

    const c = call as any;
    return {
      success: true,
      data: { ...call, orderId: c.appeal?.orderId ?? null, source: c.appeal?.sourceType ?? null, masterName: c.master?.name || null },
    };
  }

  async createCall(dto: CreateCallDto, user: any) {
    const phoneAts = dto.phoneAts || '';

    const call = await this.prisma.call.create({
      data: {
        cityId: dto.cityId || 1,
        rkId: dto.rkId || 1,
        callDirection: dto.callDirection || 'inbound',
        callId: dto.callId || `MANUAL-${Date.now()}`,
        phoneClient: dto.phoneClient,
        phoneAts,
        duration: dto.duration,
        status: dto.status,
        operatorId: user.userId,
        masterId: dto.masterId || null,
        directorId: dto.directorId || null,
        note: dto.note || null,
        appealId: dto.appealId || null,
      },
      include: {
        operator: { select: { id: true, name: true } },
        master: { select: { id: true, name: true } },
        appeal: { select: { id: true, sourceType: true, orderId: true } },
      },
    });

    this.auditLogger.logCallCreated(call.id, user.userId, user.login, {
      phoneClient: dto.phoneClient,
      status: dto.status,
    });

    await this.realtimeService.broadcastNewCall(call, [
      'operators',
      `operator:${user.userId}`,
    ]);

    return { success: true, message: 'Call created successfully', data: call };
  }

  async updateCall(id: number, dto: UpdateCallDto) {
    const call = await this.prisma.call.update({
      where: { id },
      data: {
        ...(dto.status && { status: dto.status }),
        ...(dto.duration !== undefined && { duration: dto.duration }),
        ...(dto.callDirection && { callDirection: dto.callDirection }),
        ...(dto.masterId !== undefined && { masterId: dto.masterId }),
        ...(dto.directorId !== undefined && { directorId: dto.directorId }),
        ...(dto.note !== undefined && { note: dto.note }),
        ...(dto.appealId !== undefined && { appealId: dto.appealId }),
      },
    });

    this.auditLogger.logCallUpdated(call.id, undefined, undefined, { changes: dto });

    return { success: true, message: 'Call updated successfully', data: call };
  }

  async getCallsByPhone(phone: string) {
    const calls = await this.prisma.call.findMany({
      where: { phoneClient: { contains: phone } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        cityId: true,
        city: { select: { id: true, name: true } },
        rkId: true,
        rk: { select: { id: true, name: true } },
        callDirection: true,
        phoneClient: true,
        phoneAts: true,
        masterId: true,
        directorId: true,
        note: true,
        appealId: true,
        status: true,
        callId: true,
        duration: true,
        recordingPath: true,
        recordingProcessedAt: true,
        createdAt: true,
        updatedAt: true,
        operator: { select: { id: true, name: true, login: true, sipAddress: true } },
        appeal: { select: { id: true, sourceType: true, orderId: true } },
        master: { select: { id: true, name: true } },
      },
      take: 50,
    });

    return {
      success: true,
      data: calls.map((call: any) => ({ ...call, orderId: call.appeal?.orderId ?? null, source: call.appeal?.sourceType ?? null, masterName: call.master?.name || null })),
    };
  }

  async getCallsGrouped(query: any, user: any) {
    const { status, operatorId, startDate, endDate, phone, cityId, rkId } = query;

    const where: any = {};

    if (user.role === 'operator') {
      where.operatorId = { in: [user.userId, 1] };
    } else if (operatorId) {
      where.operatorId = +operatorId;
    }

    if (status && status !== 'all') where.status = status;
    if (cityId) where.cityId = +cityId;
    if (rkId) where.rkId = +rkId;
    if (phone) where.phoneClient = { contains: phone };

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const page = query.page ? +query.page : 1;
    const groupsPerPage = query.limit ? +query.limit : 10;
    const skip = (page - 1) * groupsPerPage;
    const sortOrder = query.sortOrder || 'desc';

    const uniquePhones = await this.prisma.call.groupBy({
      by: ['phoneClient'],
      where,
      _max: { createdAt: true },
      _count: { id: true },
      orderBy: { _max: { createdAt: sortOrder as 'asc' | 'desc' } },
    });

    const totalGroups = uniquePhones.length;
    const totalPages = Math.ceil(totalGroups / groupsPerPage);
    const paginatedPhones = uniquePhones.slice(skip, skip + groupsPerPage);
    const phoneNumbers = paginatedPhones.map(p => p.phoneClient);

    const calls = await this.prisma.call.findMany({
      where: { ...where, phoneClient: { in: phoneNumbers } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        cityId: true,
        city: { select: { id: true, name: true } },
        rkId: true,
        rk: { select: { id: true, name: true } },
        callDirection: true,
        phoneClient: true,
        phoneAts: true,
        masterId: true,
        directorId: true,
        note: true,
        appealId: true,
        status: true,
        callId: true,
        duration: true,
        recordingPath: true,
        recordingProcessedAt: true,
        createdAt: true,
        updatedAt: true,
        operator: { select: { id: true, name: true, login: true } },
        appeal: { select: { id: true, sourceType: true, orderId: true } },
        master: { select: { id: true, name: true } },
      },
    });

    const callsWithMasterName = calls.map((call: any) => ({
      ...call,
      orderId: call.appeal?.orderId ?? null,
      source: call.appeal?.sourceType ?? null,
      masterName: call.master?.name || null,
    }));

    const groupedCalls: Record<string, any[]> = {};
    for (const ph of phoneNumbers) groupedCalls[ph] = [];
    for (const call of callsWithMasterName) {
      if (groupedCalls[call.phoneClient]) groupedCalls[call.phoneClient].push(call);
    }

    const [totalCalls, missedCalls, answeredCalls] = await Promise.all([
      this.prisma.call.count({ where }),
      this.prisma.call.count({ where: { ...where, status: 'missed' } }),
      this.prisma.call.count({ where: { ...where, status: 'answered' } }),
    ]);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayCalls = await this.prisma.call.count({
      where: { ...where, createdAt: { gte: today } },
    });

    return {
      success: true,
      data: {
        groupedCalls,
        stats: { totalCalls, totalGroups, missedCalls, answeredCalls, todayCalls },
        pagination: { page, limit: groupsPerPage, totalGroups, totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
      },
    };
  }

  async getCallStats(query: any) {
    const { startDate, endDate, cityId } = query;

    const where: any = {};
    if (cityId) where.cityId = +cityId;
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const [totalCalls, answeredCalls, missedCalls, totalDuration] = await Promise.all([
      this.prisma.call.count({ where }),
      this.prisma.call.count({ where: { ...where, status: 'answered' } }),
      this.prisma.call.count({ where: { ...where, status: 'missed' } }),
      this.prisma.call.aggregate({ where: { ...where, status: 'answered' }, _sum: { duration: true } }),
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
      where: { id: { in: callIds } },
      data: {
        ...(data.status && { status: data.status }),
        ...(data.duration !== undefined && { duration: data.duration }),
        ...(data.callDirection && { callDirection: data.callDirection }),
        ...(data.masterId !== undefined && { masterId: data.masterId }),
        ...(data.directorId !== undefined && { directorId: data.directorId }),
        ...(data.note !== undefined && { note: data.note }),
        ...(data.appealId !== undefined && { appealId: data.appealId }),
      },
    });

    this.auditLogger.log({
      action: 'CALLS_BATCH_UPDATED',
      resourceType: 'call',
      metadata: { callIds, count: updated.count, changes: data },
    });

    return { success: true, message: `Updated ${updated.count} calls`, data: { count: updated.count } };
  }

  async getCallsByOrderId(orderId: number, user?: any) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });

    if (!order) throw new NotFoundException('Заказ не найден');

    if (user) {
      if (user.role === 'master' && order.masterId !== user.userId) {
        throw new ForbiddenException('У вас нет доступа к этому заказу');
      }
      if (user.role === 'director' && user.cityIds && !user.cityIds.includes(order.cityId)) {
        throw new ForbiddenException('Заказ не в вашем городе');
      }
    }

    let calls: any[] = [];

    if (order.callId) {
      const callIds = order.callId.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));

      if (callIds.length > 0) {
        calls = await this.prisma.call.findMany({
          where: { id: { in: callIds }, recordingPath: { not: null } },
          select: {
            id: true,
            cityId: true,
            rkId: true,
            callDirection: true,
            phoneClient: true,
            phoneAts: true,
            status: true,
            callId: true,
            duration: true,
            recordingPath: true,
            createdAt: true,
            updatedAt: true,
            operator: { select: { id: true, name: true, login: true } },
          },
          orderBy: { createdAt: 'desc' },
        });
      }
    }

    return {
      success: true,
      data: calls.map(call => ({ ...call, recordingUrl: call.recordingPath })),
    };
  }

  async initiateCallback(dto: InitiateCallbackDto, user: any) {
    try {
      const order = await this.prisma.order.findUnique({
        where: { id: dto.orderId },
        select: { id: true, phone: true, clientName: true, rkId: true, cityId: true, callId: true },
      });

      if (!order) throw new NotFoundException('Заказ не найден');
      if (!order.phone) throw new BadRequestException('У заказа отсутствует номер телефона клиента');

      let phoneAts: string | null = null;
      let callSource = '';

      // Приоритет 1: звонок из заказа
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

      // Приоритет 2: последний звонок от клиента
      if (!phoneAts) {
        const lastCall = await this.prisma.call.findFirst({
          where: { phoneClient: order.phone },
          orderBy: { createdAt: 'desc' },
          select: { phoneAts: true },
        });
        if (lastCall?.phoneAts) {
          phoneAts = lastCall.phoneAts;
          callSource = 'client_history';
        }
      }

      // Приоритет 3: дефолтный номер для города и РК
      if (!phoneAts) {
        const defaultPhone = await this.prisma.phone.findFirst({
          where: { cityId: order.cityId, rkId: order.rkId },
          select: { number: true },
        });
        if (defaultPhone?.number) {
          phoneAts = defaultPhone.number;
          callSource = 'default_city_rk';
        }
      }

      if (!phoneAts) {
        throw new BadRequestException(
          `Не найден номер АТС для звонка. Клиент не звонил, и нет дефолтного номера для cityId=${order.cityId} и rkId=${order.rkId}.`
        );
      }

      const commandId = `callback_${dto.orderId}_${Date.now()}`;
      const formattedClientPhone = order.phone.startsWith('+') ? order.phone : `+${order.phone}`;
      const formattedMasterPhone = dto.masterPhone.startsWith('+') ? dto.masterPhone : `+${dto.masterPhone}`;
      const formattedPhoneAts = phoneAts.startsWith('+') ? phoneAts : `+${phoneAts}`;

      const mangoResult = await this.mangoService.initiateCallback({
        from: formattedPhoneAts,
        to_number: formattedClientPhone,
        master_phone: formattedMasterPhone,
        command_id: commandId,
      });

      await this.auditLogger.log({
        action: 'INITIATE_CALLBACK',
        userId: user.id,
        userLogin: user.login,
        resourceType: 'callback',
        metadata: {
          userRole: user.role, orderId: dto.orderId, masterPhone: dto.masterPhone,
          clientPhone: order.phone, phoneAts, callSource, commandId, mangoCallId: mangoResult.call_id,
        },
      });

      return {
        success: true,
        message: 'Звонок инициирован. Ожидайте входящего звонка на ваш номер.',
        data: {
          commandId, mangoResponse: mangoResult, clientPhone: formattedClientPhone,
          clientName: order.clientName, phoneAts: formattedPhoneAts, masterPhone: formattedMasterPhone, callSource,
        },
      };
    } catch (error) {
      await this.auditLogger.log({
        action: 'INITIATE_CALLBACK_ERROR',
        userId: user.id,
        userLogin: user.login,
        resourceType: 'callback',
        metadata: { userRole: user.role, orderId: dto.orderId, error: error.message },
      });

      if (error instanceof NotFoundException || error instanceof BadRequestException) throw error;
      throw new BadRequestException(`Не удалось инициировать звонок: ${error.message}`);
    }
  }
}
