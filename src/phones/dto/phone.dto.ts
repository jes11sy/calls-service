import { IsString, IsNotEmpty, IsOptional, MaxLength, IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class CreatePhoneDto {
  @ApiProperty({ description: 'Phone number', example: '79539979880' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  phoneNumber: string;

  @ApiProperty({ description: 'ID рекламной кампании' })
  @Type(() => Number)
  @IsNumber()
  @IsNotEmpty()
  @Min(1)
  rkId: number;

  @ApiProperty({ description: 'ID города' })
  @Type(() => Number)
  @IsNumber()
  @IsNotEmpty()
  @Min(1)
  cityId: number;

}

export class UpdatePhoneDto {
  @ApiProperty({ description: 'Phone number', example: '79539979880' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  phoneNumber: string;

  @ApiProperty({ description: 'ID рекламной кампании' })
  @Type(() => Number)
  @IsNumber()
  @IsNotEmpty()
  @Min(1)
  rkId: number;

  @ApiProperty({ description: 'ID города' })
  @Type(() => Number)
  @IsNumber()
  @IsNotEmpty()
  @Min(1)
  cityId: number;

}
