import { IsNumber, IsString, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class InitiateCallbackDto {
  @ApiProperty({ 
    example: 943, 
    description: 'ID заказа' 
  })
  @IsNumber()
  orderId: number;

  @ApiProperty({ 
    example: '+79991234567', 
    description: 'Номер телефона мастера (в международном формате)' 
  })
  @IsString()
  @Matches(/^\+?[1-9]\d{1,14}$/, {
    message: 'Некорректный формат номера телефона',
  })
  masterPhone: string;
}

