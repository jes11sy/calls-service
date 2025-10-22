import { Module } from '@nestjs/common';
import { MangoService } from './mango.service';

@Module({
  providers: [MangoService],
  exports: [MangoService],
})
export class MangoModule {}

