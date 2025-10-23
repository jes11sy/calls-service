import { Controller, Get, Param, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { RecordingsService } from './recordings.service';
import { RolesGuard, Roles, UserRole } from '../auth/roles.guard';

@ApiTags('recordings')
@Controller('recordings')
export class RecordingsController {
  constructor(private recordingsService: RecordingsService) {}

  @Get('call/:id/download')
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @ApiBearerAuth()
  @Roles(UserRole.admin, UserRole.operator, UserRole.director)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get signed URL for call recording download' })
  async getRecordingDownloadUrl(@Param('id') id: string) {
    return this.recordingsService.getRecordingDownloadUrl(+id);
  }
}

