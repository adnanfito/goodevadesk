import { defineConfig } from 'prisma/config';

// Prisma 7 no longer loads .env automatically; Node's built-in loader keeps
// this dependency-free. In Docker the variables come from the environment.
try {
  process.loadEnvFile();
} catch {
  // no .env file — rely on the process environment
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? '',
  },
});
