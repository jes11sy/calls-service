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
            OR: [
              { number: { contains: search, mode: 'insensitive' } },
              { source: { contains: search, mode: 'insensitive' } },
            ],
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
        source: true,
        createdAt: true,
        _count: { select: { calls: true } },
      },
    });

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
        source: phone.source,
        callsCount: phone._count.calls,
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
        source: true,
        createdAt: true,
        _count: { select: { calls: true } },
      },
    });

    if (!phone) throw new NotFoundException('Phone number not found');

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
        source: phone.source,
        callsCount: phone._count.calls,
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
        source: dto.source || null,
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
        source: dto.source ?? null,
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
    const phones = await this.prisma.phone.findMany({
      where: { source: { not: null } },
      select: { source: true },
      distinct: ['source'],
      orderBy: { source: 'asc' },
    });
    const sources = phones.map(p => p.source).filter(Boolean) as string[];
    return { success: true, data: sources };
  }
}
