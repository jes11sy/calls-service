import { IsString, IsNumber, IsOptional, IsIn, IsDateString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateCallDto {
  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  callId?: string;

  @ApiProperty()
  @IsString()
  phoneClient: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  phoneOperator?: string;

  @ApiProperty({ enum: ['inbound', 'outbound'] })
  @IsString()
  @IsIn(['inbound', 'outbound'])
  direction: string;

  @ApiProperty({ required: false })
  @IsDateString()
  @IsOptional()
  callDate?: string;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  duration?: number;

  @ApiProperty({ enum: ['answered', 'missed', 'busy', 'failed'] })
  @IsString()
  @IsIn(['answered', 'missed', 'busy', 'failed'])
  status: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  recordUrl?: string;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  orderId?: number;
}

export class UpdateCallDto {
  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  status?: string;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  duration?: number;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  recordUrl?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  recordFile?: string;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  orderId?: number;
}

