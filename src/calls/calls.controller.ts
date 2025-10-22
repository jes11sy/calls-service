import { Controller, Get, Post, Put, Body, Param, Query, UseGuards, Request, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { CallsService } from './calls.service';
import { CreateCallDto, UpdateCallDto } from './dto/call.dto';
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
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @ApiBearerAuth()
  @Roles(UserRole.CALLCENTRE_ADMIN, UserRole.CALLCENTRE_OPERATOR, UserRole.DIRECTOR)
  @ApiOperation({ summary: 'Get all calls' })
  async getCalls(@Query() query: any, @Request() req: any) {
    return this.callsService.getCalls(query, req.user);
  }

  @Get('stats')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @ApiBearerAuth()
  @Roles(UserRole.CALLCENTRE_ADMIN, UserRole.DIRECTOR)
  @ApiOperation({ summary: 'Get call statistics' })
  async getCallStats(@Query() query: any) {
    return this.callsService.getCallStats(query);
  }

  @Get(':id')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @ApiBearerAuth()
  @Roles(UserRole.CALLCENTRE_ADMIN, UserRole.CALLCENTRE_OPERATOR, UserRole.DIRECTOR)
  @ApiOperation({ summary: 'Get call by ID' })
  async getCall(@Param('id') id: string) {
    return this.callsService.getCall(+id);
  }

  @Post()
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @ApiBearerAuth()
  @Roles(UserRole.CALLCENTRE_ADMIN, UserRole.CALLCENTRE_OPERATOR)
  @ApiOperation({ summary: 'Create call manually' })
  async createCall(@Body() dto: CreateCallDto, @Request() req: any) {
    return this.callsService.createCall(dto, req.user);
  }

  @Put(':id')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @ApiBearerAuth()
  @Roles(UserRole.CALLCENTRE_ADMIN)
  @ApiOperation({ summary: 'Update call' })
  async updateCall(@Param('id') id: string, @Body() dto: UpdateCallDto) {
    return this.callsService.updateCall(+id, dto);
  }

  @Get('by-phone/:phone')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @ApiBearerAuth()
  @Roles(UserRole.CALLCENTRE_ADMIN, UserRole.CALLCENTRE_OPERATOR, UserRole.DIRECTOR)
  @ApiOperation({ summary: 'Get calls by phone number' })
  async getCallsByPhone(@Param('phone') phone: string) {
    return this.callsService.getCallsByPhone(phone);
  }
}




