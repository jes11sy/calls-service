import { Controller, Get, Post, Put, Body, Param, Query, UseGuards, Request, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { CookieJwtAuthGuard } from '../auth/guards/cookie-jwt-auth.guard';
import { CallsService } from './calls.service';
import { CreateCallDto, UpdateCallDto } from './dto/call.dto';
import { InitiateCallbackDto } from './dto/initiate-callback.dto';
import { GetCallsQueryDto } from './dto/call-query.dto';
import { RolesGuard, Roles, UserRole } from '../auth/roles.guard';

@ApiTags('calls')
@Controller('calls')
export class CallsController {
  constructor(private callsService: CallsService) {}

  @Get('health')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Health check endpoint' })
  async health() {
    return {
      success: true,
      message: 'Calls module is healthy',
      timestamp: new Date().toISOString(),
    };
  }

  @Get()
  @UseGuards(CookieJwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles(UserRole.ADMIN, UserRole.OPERATOR, UserRole.DIRECTOR)
  @ApiOperation({ summary: 'Get all calls' })
  async getCalls(@Query() query: GetCallsQueryDto, @Request() req: any) {
    return this.callsService.getCalls(query, req.user);
  }

  @Get('stats')
  @UseGuards(CookieJwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles(UserRole.ADMIN, UserRole.DIRECTOR)
  @ApiOperation({ summary: 'Get call statistics' })
  async getCallStats(@Query() query: any) {
    return this.callsService.getCallStats(query);
  }

  @Get('order/:orderId')
  @UseGuards(CookieJwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles(UserRole.ADMIN, UserRole.OPERATOR, UserRole.DIRECTOR, UserRole.MASTER)
  @ApiOperation({ summary: 'Get calls by order ID (only calls with recordings)' })
  async getCallsByOrderId(@Param('orderId') orderId: string) {
    return this.callsService.getCallsByOrderId(+orderId);
  }

  @Get(':id')
  @UseGuards(CookieJwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles(UserRole.ADMIN, UserRole.OPERATOR, UserRole.DIRECTOR)
  @ApiOperation({ summary: 'Get call by ID' })
  async getCall(@Param('id') id: string) {
    return this.callsService.getCall(+id);
  }

  @Post()
  @UseGuards(CookieJwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles(UserRole.ADMIN, UserRole.OPERATOR)
  @ApiOperation({ summary: 'Create call manually' })
  async createCall(@Body() dto: CreateCallDto, @Request() req: any) {
    return this.callsService.createCall(dto, req.user);
  }

  @Put(':id')
  @UseGuards(CookieJwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Update call' })
  async updateCall(@Param('id') id: string, @Body() dto: UpdateCallDto) {
    return this.callsService.updateCall(+id, dto);
  }

  @Get('by-phone/:phone')
  @UseGuards(CookieJwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles(UserRole.ADMIN, UserRole.OPERATOR, UserRole.DIRECTOR)
  @ApiOperation({ summary: 'Get calls by phone number' })
  async getCallsByPhone(@Param('phone') phone: string) {
    return this.callsService.getCallsByPhone(phone);
  }

  @Post('initiate-callback')
  @UseGuards(CookieJwtAuthGuard, RolesGuard)
  @ApiBearerAuth()
  @Roles(UserRole.MASTER, UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ 
    summary: 'Initiate callback to client',
    description: 'Мастер инициирует звонок клиенту через Mango Office. Сначала система звонит мастеру, затем соединяет с клиентом.'
  })
  async initiateCallback(
    @Body() dto: InitiateCallbackDto,
    @Request() req: any,
  ) {
    return this.callsService.initiateCallback(dto, req.user);
  }
}





