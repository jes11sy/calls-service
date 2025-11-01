import { IsString, IsNotEmpty, IsOptional, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreatePhoneDto {
  @ApiProperty({ description: 'Phone number', example: '+7 (495) 123-45-67' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  phoneNumber: string;

  @ApiProperty({ description: 'Campaign name', example: 'РК_Москва_1' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  campaign: string;

  @ApiProperty({ description: 'City', example: 'Москва' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  city: string;

  @ApiProperty({ description: 'Avito account name', example: 'Avito_Moscow_Main', required: false })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  accountName?: string;
}

export class UpdatePhoneDto {
  @ApiProperty({ description: 'Phone number', example: '+7 (495) 123-45-67' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  phoneNumber: string;

  @ApiProperty({ description: 'Campaign name', example: 'РК_Москва_1' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  campaign: string;

  @ApiProperty({ description: 'City', example: 'Москва' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  city: string;

  @ApiProperty({ description: 'Avito account name', example: 'Avito_Moscow_Main', required: false })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  accountName?: string;
}

