import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCallDto, UpdateCallDto } from './dto/call.dto';

@Injectable()
export class CallsService {
  constructor(private prisma: PrismaService) {}

  async getCalls(query: any, user: any) {
    const { status, operatorId, startDate, endDate, phone, city } = query;

    const where: any = {};

    // Если это оператор - показываем только его звонки
    if (user.role === 'CALLCENTRE_OPERATOR') {
      where.operatorId = user.userId;
    }

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

    const calls = await this.prisma.call.findMany({
      where,
      orderBy: { dateCreate: 'desc' },
      include: {
        operator: {
          select: {
            id: true,
            name: true,
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
      include: {
        operator: {
          select: {
            id: true,
            name: true,
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
}




