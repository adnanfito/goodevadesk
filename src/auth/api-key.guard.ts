import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';
import { hashApiKey } from './api-key.util';
import type { AuthenticatedRequest } from './current-org.decorator';
import { IS_PUBLIC_KEY } from './public.decorator';

export const API_KEY_HEADER = 'x-api-key';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const apiKey = request.header(API_KEY_HEADER);
    if (!apiKey) {
      throw new UnauthorizedException(`Missing ${API_KEY_HEADER} header`);
    }

    const organization = await this.prisma.organization.findUnique({
      where: { apiKey: hashApiKey(apiKey) },
      select: { id: true, name: true },
    });
    if (!organization) {
      throw new UnauthorizedException('Invalid API key');
    }

    request.organization = organization;
    return true;
  }
}
