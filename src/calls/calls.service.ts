import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCallDto, UpdateCallDto } from './dto/call.dto';

@Injectable()
export class CallsService {
  constructor(private prisma: PrismaService) {}

  async getCalls(query: any, user: any) {
    const { direction, status, operatorId, startDate, endDate, phone } = query;

    const where: any = {};

    // Если это оператор - показываем только его звонки
    if (user.role === 'CALLCENTRE_OPERATOR') {
      where.operatorId = user.userId;
    }

    if (direction) {
      where.direction = direction;
    }

    if (status) {
      where.status = status;
    }

    if (operatorId) {
      where.operatorId = +operatorId;
    }

    if (phone) {
      where.phoneClient = { contains: phone };
    }

    if (startDate || endDate) {
      where.callDate = {};
      if (startDate) where.callDate.gte = new Date(startDate);
      if (endDate) where.callDate.lte = new Date(endDate);
    }

    const calls = await this.prisma.call.findMany({
      where,
      orderBy: { callDate: 'desc' },
      include: {
        operator: {
          select: {
            id: true,
            name: true,
          },
        },
        order: {
          select: {
            id: true,
            rk: true,
            clientName: true,
            statusOrder: true,
          },
        },
      },
      take: 100, // Ограничение
    });

    return {
      success: true,
      data: calls,
    };
  }

  async getCall(id: number) {
    const call = await this.prisma.call.findUnique({
      where: { id },
      include: {
        operator: {
          select: {
            id: true,
            name: true,
          },
        },
        order: true,
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
        callId: dto.callId || `MANUAL-${Date.now()}`,
        phoneClient: dto.phoneClient,
        phoneOperator: dto.phoneOperator,
        direction: dto.direction,
        callDate: new Date(dto.callDate || Date.now()),
        duration: dto.duration,
        status: dto.status,
        recordUrl: dto.recordUrl,
        operatorId: user.userId,
        orderId: dto.orderId,
      },
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
        ...(dto.recordFile && { recordFile: dto.recordFile }),
        ...(dto.orderId !== undefined && { orderId: dto.orderId }),
      },
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
      orderBy: { callDate: 'desc' },
      include: {
        operator: {
          select: {
            id: true,
            name: true,
          },
        },
        order: {
          select: {
            id: true,
            rk: true,
            clientName: true,
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
    const { startDate, endDate } = query;

    const where: any = {};

    if (startDate || endDate) {
      where.callDate = {};
      if (startDate) where.callDate.gte = new Date(startDate);
      if (endDate) where.callDate.lte = new Date(endDate);
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
}

