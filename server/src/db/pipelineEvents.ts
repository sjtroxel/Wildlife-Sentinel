import { sql } from './client.js';

interface PipelineEventRecord {
  event_id: string;
  source: string;
  stage: string;
  status: 'published' | 'filtered' | 'error' | 'posted';
  reason?: string;
}

export async function logPipelineEvent(record: PipelineEventRecord): Promise<void> {
  await sql`
    INSERT INTO pipeline_events (event_id, source, stage, status, reason)
    VALUES (${record.event_id}, ${record.source}, ${record.stage}, ${record.status}, ${record.reason ?? null})
  `;
}
