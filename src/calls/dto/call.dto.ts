import { IsString, IsNumber, IsOptional, IsIn, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class CreateCallDto {
  @ApiProperty({ required: false, description: 'ID рекламной кампании' })
  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  @Min(1)
  rkId?: number;

  @ApiProperty({ required: false, description: 'ID города' })
  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  @Min(1)
  cityId?: number;

  @ApiProperty({ required: false, enum: ['inbound', 'outbound', 'callback'] })
  @IsString()
  @IsOptional()
  @IsIn(['inbound', 'outbound', 'callback'])
  callDirection?: string;

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
  phoneAts?: string;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  duration?: number;

  @ApiProperty({ enum: ['answered', 'missed', 'busy', 'no_answer'] })
  @IsString()
  @IsIn(['answered', 'missed', 'busy', 'no_answer'])
  status: string;
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

  @ApiProperty({ required: false, enum: ['inbound', 'outbound', 'callback'] })
  @IsString()
  @IsOptional()
  @IsIn(['inbound', 'outbound', 'callback'])
  callDirection?: string;
}
