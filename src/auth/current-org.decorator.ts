import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export interface AuthenticatedOrg {
  id: string;
  name: string;
}

export interface AuthenticatedRequest extends Request {
  organization?: AuthenticatedOrg;
}

/** The organization resolved from the `x-api-key` header by ApiKeyGuard. */
export const CurrentOrg = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedOrg => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.organization) {
      // Only reachable if a route is marked @Public() but still asks for an org.
      throw new Error('CurrentOrg used on a route without ApiKeyGuard');
    }
    return request.organization;
  },
);
