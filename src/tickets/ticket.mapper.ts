import type { Ticket } from '../generated/prisma/client';

/** Public API shape (snake_case, as in the spec). */
export function toTicketResponse(ticket: Ticket) {
  return {
    id: ticket.id,
    organization_id: ticket.organizationId,
    customer_email: ticket.customerEmail,
    subject: ticket.subject,
    message: ticket.message,
    category: ticket.category,
    suggested_reply: ticket.suggestedReply,
    status: ticket.status,
    ai_status: ticket.aiStatus,
    ai_source: ticket.aiSource,
    ai_error: ticket.aiError,
    created_at: ticket.createdAt,
    updated_at: ticket.updatedAt,
  };
}

export type TicketResponse = ReturnType<typeof toTicketResponse>;
