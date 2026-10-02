import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Skips API key authentication for a route or controller. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
