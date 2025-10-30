import { IsString, IsNumber, IsOptional, IsIn, IsObject, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class CallParticipantDto {
  @ApiProperty()
  @IsString()
  number: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  type?: string;
}

export class MangoWebhookDto {
  @ApiProperty()
  @IsString()
  call_id: string;

  @ApiProperty({ enum: ['Appeared', 'Connected', 'Disconnected'] })
  @IsString()
  @IsIn(['Appeared', 'Connected', 'Disconnected'])
  call_state: string;

  @ApiProperty({ type: CallParticipantDto })
  @IsObject()
  @ValidateNested()
  @Type(() => CallParticipantDto)
  from: CallParticipantDto;

  @ApiProperty({ type: CallParticipantDto })
  @IsObject()
  @ValidateNested()
  @Type(() => CallParticipantDto)
  to: CallParticipantDto;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  timestamp?: number;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  create_time?: number;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  answer_time?: number;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  end_time?: number;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  disconnect_reason?: number;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  entry_id?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  location?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  command_id?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  result?: string;

  @ApiProperty({ required: false })
  @IsNumber()
  @IsOptional()
  duration?: number;
}

export class MangoRecordingWebhookDto {
  @ApiProperty()
  @IsString()
  entry_id: string;

  @ApiProperty()
  @IsString()
  recording_id: string;

  @ApiProperty({ enum: ['Started', 'Processing', 'Completed', 'Failed'] })
  @IsString()
  @IsIn(['Started', 'Processing', 'Completed', 'Failed'])
  recording_state: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  recording_url?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  call_id?: string;
}

