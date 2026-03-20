import http from 'http';
import { URL } from 'url';
import {
  getTotalRequests,
  getRequestsByModel,
  getRequestsByProvider,
  getRequestsBySource,
  getRecentLogs,
  getSuccessRate,
  getAvgLatency,
} from './db.js';

function getDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Aido Analytics Dashboard</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; color: #333; padding: 20px; }
    h1 { margin-bottom: 20px; color: #1a1a1a; }
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 24px; }
    .stat-card { background: white; border-radius: 8px; padding: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .stat-card h3 { font-size: 14px; color: #666; margin-bottom: 8px; }
    .stat-card .value { font-size: 32px; font-weight: 600; color: #1a1a1a; }
    .section { background: white; border-radius: 8px; padding: 20px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .section h2 { margin-bottom: 16px; font-size: 18px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 12px; border-bottom: 1px solid #eee; }
    th { font-weight: 600; color: #666; }
    tr:hover { background: #fafafa; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 500; }
    .badge-success { background: #dcfce7; color: #166534; }
    .badge-error { background: #fee2e2; color: #991b1b; }
    .refresh-info { font-size: 12px; color: #666; margin-top: 16px; }
  </style>
</head>
<body>
  <h1>Aido Analytics Dashboard</h1>
  
  <div class="stats-grid">
    <div class="stat-card">
      <h3>Total Requests</h3>
      <div class="value" id="totalRequests">-</div>
    </div>
    <div class="stat-card">
      <h3>Success Rate</h3>
      <div class="value" id="successRate">-</div>
    </div>
    <div class="stat-card">
      <h3>Avg Latency</h3>
      <div class="value" id="avgLatency">-</div>
    </div>
  </div>

  <div class="section">
    <h2>Top Models</h2>
    <table>
      <thead>
        <tr><th>Model</th><th>Requests</th><th>Success</th><th>Failure</th><th>Avg Latency</th></tr>
      </thead>
      <tbody id="modelsTable">
        <tr><td colspan="5">Loading...</td></tr>
      </tbody>
    </table>
  </div>

  <div class="section">
    <h2>Recent Logs</h2>
    <table>
      <thead>
        <tr><th>Time</th><th>Provider</th><th>Model</th><th>Status</th><th>Latency</th></tr>
      </thead>
      <tbody id="logsTable">
        <tr><td colspan="5">Loading...</td></tr>
      </tbody>
    </table>
    <p class="refresh-info">Auto-refreshes every 5 seconds</p>
  </div>

  <script>
    async function loadData() {
      try {
        const [statsRes, modelsRes, logsRes] = await Promise.all([
          fetch('/api/stats'),
          fetch('/api/models'),
          fetch('/api/logs?limit=50')
        ]);
        
        const stats = await statsRes.json();
        document.getElementById('totalRequests').textContent = stats.totalRequests;
        document.getElementById('successRate').textContent = stats.successRate + '%';
        document.getElementById('avgLatency').textContent = stats.avgLatency + 'ms';
        
        const models = await modelsRes.json();
        const modelsTable = document.getElementById('modelsTable');
        if (models.length === 0) {
          modelsTable.innerHTML = '<tr><td colspan="5">No data</td></tr>';
        } else {
          modelsTable.innerHTML = models.map(m => \`
            <tr>
              <td>\${m.model}</td>
              <td>\${m.count}</td>
              <td><span class="badge badge-success">\${m.successCount}</span></td>
              <td><span class="badge badge-error">\${m.failureCount}</span></td>
              <td>\${Math.round(m.avgLatency)}ms</td>
            </tr>
          \`).join('');
        }
        
        const logs = await logsRes.json();
        const logsTable = document.getElementById('logsTable');
        if (logs.length === 0) {
          logsTable.innerHTML = '<tr><td colspan="5">No data</td></tr>';
        } else {
          logsTable.innerHTML = logs.map(l => \`
            <tr>
              <td>\${new Date(l.ts * 1000).toLocaleTimeString()}</td>
              <td>\${l.provider}</td>
              <td>\${l.model || '-'}</td>
              <td><span class="badge \${l.status >= 400 ? 'badge-error' : 'badge-success'}">\${l.status}</span></td>
              <td>\${l.latencyMs}ms</td>
            </tr>
          \`).join('');
        }
      } catch (err) {
        console.error('Failed to load data:', err);
      }
    }
    
    loadData();
    setInterval(loadData, 5000);
  </script>
</body>
</html>`;
}

export function startAnalyticsServer(port = 4142): http.Server {
  const server = http.createServer((req, res) => {
    const urlStr = req.url ?? '/';
    const url = new URL(urlStr, `http://localhost:${port}`);
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (url.pathname === '/' && req.method === 'GET') {
      res.setHeader('Content-Type', 'text/html');
      res.end(getDashboardHtml());
      return;
    }

    if (url.pathname === '/api/stats' && req.method === 'GET') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        totalRequests: getTotalRequests(),
        successRate: getSuccessRate(),
        avgLatency: getAvgLatency(),
      }));
      return;
    }

    if (url.pathname === '/api/models' && req.method === 'GET') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(getRequestsByModel()));
      return;
    }

    if (url.pathname === '/api/providers' && req.method === 'GET') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(getRequestsByProvider()));
      return;
    }

    if (url.pathname === '/api/sources' && req.method === 'GET') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(getRequestsBySource()));
      return;
    }

    if (url.pathname === '/api/logs' && req.method === 'GET') {
      const limit = parseInt(url.searchParams.get('limit') ?? '50');
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(getRecentLogs(limit)));
      return;
    }

    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  server.listen(port);
  return server;
}
