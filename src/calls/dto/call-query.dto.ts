import { IsOptional, IsString, IsInt, Min, Max, IsIn, Matches } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class GetCallsQueryDto {
  @ApiProperty({ required: false, enum: ['answered', 'missed', 'busy', 'no_answer'] })
  @IsOptional()
  @IsString()
  @IsIn(['answered', 'missed', 'busy', 'no_answer'])
  status?: string;

  @ApiProperty({ required: false, type: Number })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  operatorId?: number;

  @ApiProperty({ required: false, description: 'ID города' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  cityId?: number;

  @ApiProperty({ required: false, description: 'ID рекламной кампании' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  rkId?: number;

  @ApiProperty({ required: false, example: '2024-01-01' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'startDate must be in YYYY-MM-DD format' })
  startDate?: string;

  @ApiProperty({ required: false, example: '2024-12-31' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'endDate must be in YYYY-MM-DD format' })
  endDate?: string;

  @ApiProperty({ required: false, example: '+79991234567' })
  @IsOptional()
  @IsString()
  @Matches(/^\+?[0-9]{10,15}$/, { message: 'phone must be valid phone number' })
  phone?: string;

  @ApiProperty({ required: false, type: Number, default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiProperty({ required: false, type: Number, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;
}
