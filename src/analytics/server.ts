import { startAnalyticsServer } from './api.js';

const port = parseInt(process.env.ANALYTICS_PORT ?? '4142', 10);

console.log(`[analytics] Starting AIdo Analytics Dashboard...`);
const server = startAnalyticsServer(port);
console.log(`[analytics] Dashboard available at http://localhost:${port}`);
console.log(`[analytics] Press Ctrl+C to stop`);

process.on('SIGINT', () => {
  console.log('\n[analytics] Shutting down...');
  server.close();
  process.exit(0);
});
