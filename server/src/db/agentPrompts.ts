import { sql } from './client.js';

/**
 * Load an agent's current system prompt from the database.
 * Prompts are stored in agent_prompts and can be updated by the Refiner.
 */
export async function getAgentPrompt(agentName: string): Promise<string> {
  const rows = await sql<{ system_prompt: string }[]>`
    SELECT system_prompt FROM agent_prompts WHERE agent_name = ${agentName}
  `;
  if (!rows[0]) throw new Error(`No prompt found for agent: ${agentName}`);
  return rows[0].system_prompt;
}
