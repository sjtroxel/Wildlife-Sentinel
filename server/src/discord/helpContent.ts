export const SLASH_COMMANDS = [
  { name: '/species <name>', description: 'Look up any monitored species (autocomplete supported).' },
  { name: '/status',         description: 'Show pipeline health and whether monitoring is active.' },
  { name: '/pause',          description: 'Pause the pipeline (admin only).' },
  { name: '/resume',         description: 'Resume the pipeline (admin only).' },
  { name: '/help',           description: 'Show this message.' },
] as const;
