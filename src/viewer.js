#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createViewerServer } from './viewerServer.js';

const PORT = Number(process.env.ROUTEBENCH_VIEWER_PORT) || 3001;
const RESULTS_DIR = process.argv[2] === '--results' ? process.argv[3] : 'results';

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

const server = createViewerServer({ port: PORT, resultsDir: RESULTS_DIR });

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${PORT}`;
  console.log(`RouteBench Viewer: ${url}`);
  console.log(`Results dir: ${RESULTS_DIR}`);
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
