import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  type AuthenticatedOrg,
  CurrentOrg,
} from '../auth/current-org.decorator';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { ListTicketsQueryDto } from './dto/list-tickets.query.dto';
import { UpdateTicketStatusDto } from './dto/update-status.dto';
import { TicketsService } from './tickets.service';

@Controller('tickets')
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @Post()
  create(@CurrentOrg() org: AuthenticatedOrg, @Body() dto: CreateTicketDto) {
    return this.tickets.create(org.id, dto);
  }

  @Get()
  findAll(
    @CurrentOrg() org: AuthenticatedOrg,
    @Query() query: ListTicketsQueryDto,
  ) {
    return this.tickets.findAll(org.id, query);
  }

  @Get(':id')
  findOne(
    @CurrentOrg() org: AuthenticatedOrg,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.tickets.findOne(org.id, id);
  }

  @Patch(':id/status')
  updateStatus(
    @CurrentOrg() org: AuthenticatedOrg,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateTicketStatusDto,
  ) {
    return this.tickets.updateStatus(org.id, id, dto);
  }
}
