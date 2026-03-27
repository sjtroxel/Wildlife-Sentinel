import { sql } from './client.js';

interface ModelUsageRecord {
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
}

export async function logModelUsage(record: ModelUsageRecord): Promise<void> {
  await sql`
    INSERT INTO model_usage (model, input_tokens, output_tokens, estimated_cost_usd)
    VALUES (${record.model}, ${record.inputTokens}, ${record.outputTokens}, ${record.estimatedCostUsd})
  `;
}

export async function getTotalCostUsd(): Promise<number> {
  const result = await sql<{ total: string }[]>`
    SELECT COALESCE(SUM(estimated_cost_usd), 0)::text AS total FROM model_usage
  `;
  return parseFloat(result[0]?.total ?? '0');
}

export async function getCostByModel(): Promise<Array<{ model: string; total_cost: string; call_count: string }>> {
  return sql`
    SELECT model,
           SUM(estimated_cost_usd)::text AS total_cost,
           COUNT(*)::text                AS call_count
    FROM model_usage
    GROUP BY model
    ORDER BY SUM(estimated_cost_usd) DESC
  `;
}
