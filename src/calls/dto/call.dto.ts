import { IsString, IsNumber, IsOptional, IsIn, IsDateString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateCallDto {
  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  rk?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  city?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  avitoName?: string;

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
  @IsDateString()
  @IsOptional()
  dateCreate?: string;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  duration?: number;

  @ApiProperty({ enum: ['answered', 'missed', 'busy', 'no_answer'] })
  @IsString()
  @IsIn(['answered', 'missed', 'busy', 'no_answer'])
  status: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  recordUrl?: string;
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
}




