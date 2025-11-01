import { Module } from '@nestjs/common';
import { PhonesController } from './phones.controller';
import { PhonesService } from './phones.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [PhonesController],
  providers: [PhonesService],
  exports: [PhonesService],
})
export class PhonesModule {}

