import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TRIAGE_QUEUE } from '../triage/triage.constants';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';

@Module({
  imports: [BullModule.registerQueue({ name: TRIAGE_QUEUE })],
  controllers: [TicketsController],
  providers: [TicketsService],
})
export class TicketsModule {}
