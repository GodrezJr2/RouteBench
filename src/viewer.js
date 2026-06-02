#!/usr/bin/env node
// Local-first tool — disable TLS cert verification for self-signed local router endpoints.
// Do not use this process for untrusted external HTTPS connections.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { spawn } from 'node:child_process';
import { readdirSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createViewerServer } from './viewerServer.js';
import { openHistory, resultToHistoryEntry } from './history.js';

const PORT       = Number(process.env.ROUTEBENCH_VIEWER_PORT) || 3001;
const RESULTS_DIR = process.argv[2] === '--results' ? process.argv[3] : 'results';
const HISTORY_DB  = process.env.ROUTEBENCH_HISTORY_DB || join(RESULTS_DIR, '.routebench-history.db');

function openBrowser(url) {
  try {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], { detached: true, shell: false, stdio: 'ignore' });
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' });
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
    }
  } catch {
    // ignore — user opens manually
  }
}

// Backfill: import any results/*.json that aren't already in history
function backfillHistory(history, resultsDir) {
  try {
    if (!existsSync(resultsDir)) return;
    const files = readdirSync(resultsDir).filter((f) => f.endsWith('.json') && !f.startsWith('.'));
    for (const f of files) {
      const resultPath = `${resultsDir}/${f}`.replace(/\\/g, '/');
      if (history.hasPath(resultPath)) continue;
      try {
        const data = JSON.parse(readFileSync(join(resultsDir, f), 'utf8'));
        if (data.schema_version !== 'routebench.phase0.v1') continue;
        const runId = data.started_at?.replace(/\D/g, '') || resultPath;
        history.saveIfNew(resultToHistoryEntry(data, { run_id: runId, result_path: resultPath, benchmark: null }));
      } catch { /* skip unparseable files */ }
    }
  } catch { /* backfill errors must not prevent startup */ }
}

mkdirSync(RESULTS_DIR, { recursive: true });
const history = openHistory(HISTORY_DB);
backfillHistory(history, RESULTS_DIR);

const server = createViewerServer({ port: PORT, resultsDir: RESULTS_DIR, history });

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${PORT}`;
  console.log(`RouteBench Viewer: ${url}`);
  console.log(`Results dir:  ${RESULTS_DIR}`);
  console.log(`History:      ${HISTORY_DB}`);
  console.log('Press Ctrl+C to stop.');
  openBrowser(url);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} already in use. Set ROUTEBENCH_VIEWER_PORT to use a different port.`);
  } else {
    console.error(err.message);
  }
  process.exitCode = 1;
});
