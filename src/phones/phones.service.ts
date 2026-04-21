import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePhoneDto, UpdatePhoneDto } from './dto/phone.dto';

@Injectable()
export class PhonesService {
  constructor(private prisma: PrismaService) {}

  async getPhones(search?: string) {
    const phones = await this.prisma.phone.findMany({
      where: search
        ? {
            OR: [{ number: { contains: search, mode: 'insensitive' } }],
          }
        : undefined,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        number: true,
        cityId: true,
        city: { select: { id: true, name: true } },
        rkId: true,
        rk: { select: { id: true, name: true, code: true } },
        createdAt: true,
      },
    });

    const callCounts = await this.prisma.call.groupBy({
      by: ['phoneAts'],
      _count: {
        _all: true,
      },
    });

    const callsCountByPhone = new Map(
      callCounts
        .filter((item) => item.phoneAts)
        .map((item) => [item.phoneAts, item._count._all]),
    );

    return {
      success: true,
      data: phones.map(phone => ({
        id: phone.id,
        phoneNumber: phone.number,
        cityId: phone.cityId,
        cityName: phone.city?.name,
        rkId: phone.rkId,
        rkName: phone.rk?.name,
        rkCode: phone.rk?.code,
        source: null,
        callsCount: callsCountByPhone.get(phone.number) || 0,
        createdAt: phone.createdAt,
      })),
    };
  }

  async getPhone(id: number) {
    const phone = await this.prisma.phone.findUnique({
      where: { id },
      select: {
        id: true,
        number: true,
        cityId: true,
        city: { select: { id: true, name: true } },
        rkId: true,
        rk: { select: { id: true, name: true, code: true } },
        createdAt: true,
      },
    });

    if (!phone) throw new NotFoundException('Phone number not found');

    const callsCount = await this.prisma.call.count({
      where: {
        phoneAts: phone.number,
      },
    });

    return {
      success: true,
      data: {
        id: phone.id,
        phoneNumber: phone.number,
        cityId: phone.cityId,
        cityName: phone.city?.name,
        rkId: phone.rkId,
        rkName: phone.rk?.name,
        rkCode: phone.rk?.code,
        source: null,
        callsCount,
        createdAt: phone.createdAt,
      },
    };
  }

  async createPhone(dto: CreatePhoneDto) {
    const phone = await this.prisma.phone.create({
      data: {
        number: dto.phoneNumber,
        rkId: dto.rkId,
        cityId: dto.cityId,
      },
    });

    return { success: true, data: phone };
  }

  async updatePhone(id: number, dto: UpdatePhoneDto) {
    const phone = await this.prisma.phone.findUnique({ where: { id } });
    if (!phone) throw new NotFoundException('Phone number not found');

    const updated = await this.prisma.phone.update({
      where: { id },
      data: {
        number: dto.phoneNumber,
        rkId: dto.rkId,
        cityId: dto.cityId,
      },
    });

    return { success: true, data: updated };
  }

  async deletePhone(id: number) {
    const phone = await this.prisma.phone.findUnique({ where: { id } });
    if (!phone) throw new NotFoundException('Phone number not found');

    await this.prisma.phone.delete({ where: { id } });

    return { success: true, message: 'Phone number deleted successfully' };
  }

  async getCities() {
    const cities = await this.prisma.city.findMany({
      where: { isActive: true },
      select: { id: true, name: true, code: true },
      orderBy: { name: 'asc' },
    });
    return { success: true, data: cities };
  }

  async getCampaigns() {
    const rks = await this.prisma.rk.findMany({
      where: { isActive: true },
      select: { id: true, name: true, code: true },
      orderBy: { name: 'asc' },
    });
    return { success: true, data: rks };
  }

  async getSources() {
    return { success: true, data: [] };
  }
}
