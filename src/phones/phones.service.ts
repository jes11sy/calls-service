import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePhoneDto, UpdatePhoneDto } from './dto/phone.dto';

@Injectable()
export class PhonesService {
  constructor(private prisma: PrismaService) {}

  async getPhones(search?: string) {
    const where: any = {};

    if (search) {
      where.OR = [
        { number: { contains: search, mode: 'insensitive' } },
        { rk: { contains: search, mode: 'insensitive' } },
        { avitoName: { contains: search, mode: 'insensitive' } },
      ];
    }

    const phones = await this.prisma.phone.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        number: true,
        rk: true,
        city: true,
        avitoName: true,
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

    // Преобразуем данные для фронта
    const phonesWithCallsCount = phones.map(phone => ({
      id: phone.id,
      phoneNumber: phone.number,
      campaign: phone.rk,
      city: phone.city,
      accountName: phone.avitoName || 'Не указан',
      callsCount: callsCountByPhone.get(phone.number) || 0,
      createdAt: phone.createdAt,
    }));

    return {
      success: true,
      data: phonesWithCallsCount,
    };
  }

  async getPhone(id: number) {
    const phone = await this.prisma.phone.findUnique({
      where: { id },
      select: {
        id: true,
        number: true,
        rk: true,
        city: true,
        avitoName: true,
        createdAt: true,
      },
    });

    if (!phone) {
      throw new NotFoundException('Phone number not found');
    }

    const callsCount = await this.prisma.call.count({
      where: {
        phoneAts: phone.number,
      },
    });

    // Преобразуем данные для фронта
    const phoneData = {
      id: phone.id,
      phoneNumber: phone.number,
      campaign: phone.rk,
      city: phone.city,
      accountName: phone.avitoName || '',
      callsCount,
      createdAt: phone.createdAt,
    };

    return {
      success: true,
      data: phoneData,
    };
  }

  async createPhone(dto: CreatePhoneDto) {
    const phone = await this.prisma.phone.create({
      data: {
        number: dto.phoneNumber,
        rk: dto.campaign,
        city: dto.city,
        avitoName: dto.accountName || null,
      },
    });

    return {
      success: true,
      data: phone,
    };
  }

  async updatePhone(id: number, dto: UpdatePhoneDto) {
    const phone = await this.prisma.phone.findUnique({
      where: { id },
    });

    if (!phone) {
      throw new NotFoundException('Phone number not found');
    }

    const updated = await this.prisma.phone.update({
      where: { id },
      data: {
        number: dto.phoneNumber,
        rk: dto.campaign,
        city: dto.city,
        avitoName: dto.accountName || null,
      },
    });

    return {
      success: true,
      data: updated,
    };
  }

  async deletePhone(id: number) {
    const phone = await this.prisma.phone.findUnique({
      where: { id },
    });

    if (!phone) {
      throw new NotFoundException('Phone number not found');
    }

    await this.prisma.phone.delete({
      where: { id },
    });

    return {
      success: true,
      message: 'Phone number deleted successfully',
    };
  }

  /**
   * Получить уникальные источники (avitoName) из таблицы phones
   */
  async getSources() {
    const phones = await this.prisma.phone.findMany({
      select: {
        avitoName: true,
      },
      distinct: ['avitoName'],
      orderBy: {
        avitoName: 'asc',
      },
    });

    // Фильтруем null и пустые строки на уровне JS
    const sources = phones
      .map(p => p.avitoName)
      .filter((name): name is string => name !== null && name !== undefined && name.trim() !== '')
      .sort((a, b) => a.localeCompare(b, 'ru'));

    return {
      success: true,
      data: sources,
    };
  }

  /**
   * Получить список РК (хардкод)
   */
  async getCampaigns() {
    const campaigns = ['Листовка', 'Авито'];

    return {
      success: true,
      data: campaigns,
    };
  }

  /**
   * Получить уникальные города из таблицы phones
   */
  async getCities() {
    const phones = await this.prisma.phone.findMany({
      select: {
        city: true,
      },
      distinct: ['city'],
      orderBy: {
        city: 'asc',
      },
    });

    const cities = phones
      .map(p => p.city)
      .filter((city): city is string => city !== null && city !== undefined && city.trim() !== '')
      .sort((a, b) => a.localeCompare(b, 'ru'));

    return {
      success: true,
      data: cities,
    };
  }
}

