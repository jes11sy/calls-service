import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CookieJwtAuthGuard } from '../auth/guards/cookie-jwt-auth.guard';
import { PhonesService } from './phones.service';
import { RolesGuard, Roles, UserRole } from '../auth/roles.guard';
import { CreatePhoneDto, UpdatePhoneDto } from './dto/phone.dto';

@ApiTags('phones')
@Controller('phones')
export class PhonesController {
  constructor(private phonesService: PhonesService) {}

  @Get('health')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Health check endpoint' })
  async health() {
    return {
      success: true,
      message: 'Phones module is healthy',
      timestamp: new Date().toISOString(),
    };
  }

  @Get()
  @UseGuards(CookieJwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles(UserRole.ADMIN, UserRole.ADMIN, UserRole.DIRECTOR)
  @ApiOperation({ summary: 'Get all phone numbers' })
  async getPhones(@Query('search') search?: string) {
    return this.phonesService.getPhones(search);
  }

  @Get('sources')
  @UseGuards(CookieJwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles(UserRole.ADMIN, UserRole.ADMIN, UserRole.DIRECTOR, UserRole.OPERATOR)
  @ApiOperation({ summary: 'Get unique sources (avitoName) from phones' })
  async getSources() {
    return this.phonesService.getSources();
  }

  @Get('campaigns')
  @UseGuards(CookieJwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles(UserRole.ADMIN, UserRole.ADMIN, UserRole.DIRECTOR, UserRole.OPERATOR)
  @ApiOperation({ summary: 'Get unique campaigns (rk) from phones' })
  async getCampaigns() {
    return this.phonesService.getCampaigns();
  }

  @Get('cities')
  @UseGuards(CookieJwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles(UserRole.ADMIN, UserRole.ADMIN, UserRole.DIRECTOR, UserRole.OPERATOR)
  @ApiOperation({ summary: 'Get unique cities from phones' })
  async getCities() {
    return this.phonesService.getCities();
  }

  @Get(':id')
  @UseGuards(CookieJwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles(UserRole.ADMIN, UserRole.ADMIN, UserRole.DIRECTOR)
  @ApiOperation({ summary: 'Get phone number by ID' })
  async getPhone(@Param('id') id: string) {
    return this.phonesService.getPhone(+id);
  }

  @Post()
  @UseGuards(CookieJwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles(UserRole.ADMIN, UserRole.ADMIN)
  @ApiOperation({ summary: 'Create new phone number' })
  async createPhone(@Body() dto: CreatePhoneDto) {
    return this.phonesService.createPhone(dto);
  }

  @Put(':id')
  @UseGuards(CookieJwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles(UserRole.ADMIN, UserRole.ADMIN)
  @ApiOperation({ summary: 'Update phone number' })
  async updatePhone(@Param('id') id: string, @Body() dto: UpdatePhoneDto) {
    return this.phonesService.updatePhone(+id, dto);
  }

  @Delete(':id')
  @UseGuards(CookieJwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles(UserRole.ADMIN, UserRole.ADMIN)
  @ApiOperation({ summary: 'Delete phone number' })
  async deletePhone(@Param('id') id: string) {
    return this.phonesService.deletePhone(+id);
  }
}

