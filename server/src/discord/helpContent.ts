export const SLASH_COMMANDS = [
  { name: '/species <name>', description: 'Look up any monitored species (autocomplete supported).' },
  { name: '/trends [days]',  description: 'Show alert frequency breakdown for the last 7/14/30/90 days.' },
  { name: '/refiner',        description: 'Show Refiner prediction accuracy scores and queue status.' },
  { name: '/digest',         description: 'Preview the weekly summary report now (posts here, not to #wildlife-alerts).' },
  { name: '/status',         description: 'Show pipeline health and whether monitoring is active.' },
  { name: '/pause',          description: 'Pause the pipeline (admin only).' },
  { name: '/resume',         description: 'Resume the pipeline (admin only).' },
  { name: '/help',           description: 'Show this message.' },
] as const;
