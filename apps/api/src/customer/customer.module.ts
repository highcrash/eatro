import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SmsModule } from '../sms/sms.module';
import { CustomerService } from './customer.service';
import { CustomerController, CustomerPublicController } from './customer.controller';

@Module({
  imports: [PrismaModule, SmsModule],
  controllers: [CustomerPublicController, CustomerController],
  providers: [CustomerService],
  exports: [CustomerService],
})
export class CustomerModule {}
