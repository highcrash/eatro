import { Module } from '@nestjs/common';
import { CreditorService } from './creditor.service';
import { CreditorController } from './creditor.controller';
import { AccountModule } from '../account/account.module';

@Module({
  imports: [AccountModule],
  controllers: [CreditorController],
  providers: [CreditorService],
  exports: [CreditorService],
})
export class CreditorModule {}
