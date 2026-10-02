export const TRIAGE_QUEUE = 'ticket-triage';
export const TRIAGE_JOB = 'triage-ticket';

export interface TriageJobData {
  ticketId: string;
  organizationId: string;
}
