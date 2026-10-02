import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { generateApiKey, hashApiKey } from '../src/auth/api-key.util';

try {
  process.loadEnvFile();
} catch {
  // no .env file — rely on the process environment
}

/**
 * Seeds two organizations so tenant isolation can be demoed right away.
 * Keys come from SEED_ORG_API_KEYS ("key1,key2"); missing keys are generated
 * and printed once. Re-running is idempotent (matched by organization name).
 */
const ORGANIZATIONS = ['Acme Corp', 'Globex Inc'];

async function main() {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  const providedKeys = (process.env.SEED_ORG_API_KEYS ?? '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);

  try {
    for (const [i, name] of ORGANIZATIONS.entries()) {
      const providedKey = providedKeys[i];
      const existing = await prisma.organization.findFirst({ where: { name } });

      if (existing && !providedKey) {
        console.log(`- ${name}: already exists (key unchanged)`);
        continue;
      }

      const apiKey = providedKey ?? generateApiKey();
      if (existing) {
        await prisma.organization.update({
          where: { id: existing.id },
          data: { apiKey: hashApiKey(apiKey) },
        });
      } else {
        await prisma.organization.create({
          data: { name, apiKey: hashApiKey(apiKey) },
        });
      }
      console.log(`- ${name}: x-api-key = ${apiKey}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
