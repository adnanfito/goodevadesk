import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { SemanticCacheService } from './cache/semantic-cache.service';
import { EmbeddingService } from './embedding/embedding.service';
import { GeminiProvider } from './llm/gemini.provider';
import { LLM_PROVIDER } from './llm/llm.provider';
import { TRIAGE_QUEUE } from './triage.constants';
import { TriageProcessor } from './triage.processor';
import { TriageService } from './triage.service';

@Module({
  imports: [BullModule.registerQueue({ name: TRIAGE_QUEUE })],
  providers: [
    EmbeddingService,
    SemanticCacheService,
    { provide: LLM_PROVIDER, useClass: GeminiProvider },
    TriageService,
    TriageProcessor,
  ],
})
export class TriageModule {}
