import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Queue } from 'bullmq';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  TRIAGE_JOB,
  TRIAGE_QUEUE,
  type TriageJobData,
} from '../triage/triage.constants';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { ListTicketsQueryDto } from './dto/list-tickets.query.dto';
import { UpdateTicketStatusDto } from './dto/update-status.dto';
import { toTicketResponse } from './ticket.mapper';

const ENQUEUE_TIMEOUT_MS = 5000;

/**
 * Every method takes `organizationId` and includes it in the WHERE clause, so
 * one tenant can never read or modify another tenant's tickets.
 */
@Injectable()
export class TicketsService {
  private readonly logger = new Logger(TicketsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(TRIAGE_QUEUE) private readonly triageQueue: Queue,
  ) {}

  async create(organizationId: string, dto: CreateTicketDto) {
    const ticket = await this.prisma.ticket.create({
      data: {
        organizationId,
        customerEmail: dto.customer_email,
        subject: dto.subject,
        message: dto.message,
      },
    });

    try {
      await this.enqueueTriage({ ticketId: ticket.id, organizationId });
      return toTicketResponse(ticket);
    } catch (err) {
      // The ticket is already persisted; record the failure instead of
      // leaving ai_status stuck on "pending".
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to enqueue triage for ${ticket.id}: ${reason}`);
      const failed = await this.prisma.ticket.update({
        where: { id: ticket.id },
        data: { aiStatus: 'failed', aiError: 'Could not enqueue AI triage' },
      });
      return toTicketResponse(failed);
    }
  }

  async findAll(organizationId: string, query: ListTicketsQueryDto) {
    const where: Prisma.TicketWhereInput = {
      organizationId,
      status: query.status,
      category: query.category,
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.ticket.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.ticket.count({ where }),
    ]);

    return {
      data: items.map(toTicketResponse),
      meta: { page: query.page, limit: query.limit, total },
    };
  }

  async findOne(organizationId: string, id: string) {
    const ticket = await this.prisma.ticket.findFirst({
      where: { id, organizationId },
    });
    // 404 (not 403) so callers cannot probe for other tenants' ticket IDs.
    if (!ticket) throw new NotFoundException('Ticket not found');
    return toTicketResponse(ticket);
  }

  async updateStatus(
    organizationId: string,
    id: string,
    dto: UpdateTicketStatusDto,
  ) {
    const { count } = await this.prisma.ticket.updateMany({
      where: { id, organizationId },
      data: { status: dto.status },
    });
    if (count === 0) throw new NotFoundException('Ticket not found');
    return this.findOne(organizationId, id);
  }

  private async enqueueTriage(data: TriageJobData) {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('Timed out adding triage job')),
        ENQUEUE_TIMEOUT_MS,
      );
    });
    try {
      // jobId = ticketId makes enqueueing idempotent per ticket.
      await Promise.race([
        this.triageQueue.add(TRIAGE_JOB, data, { jobId: data.ticketId }),
        timeout,
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
}
