import type { ScanProgress } from '#lib/types.js';

import type { Engine } from './context.js';
import { scanLibrary } from './scan.js';

let running: Promise<ScanProgress> | undefined;
let latest: ScanProgress | undefined;

/** Starts a scan unless one is already running, and tells the page how it goes */
export function startScan(engine: Engine) {
  if (running) return running;
  const report = (progress: ScanProgress) => {
    latest = progress;
    engine.emit({ type: 'scan', progress });
  };
  const scan = scanLibrary(engine, (progress) => {
    report(progress);
    if (progress.phase === 'done') engine.emit({ type: 'library' });
  })
    .catch((error: Error) => {
      const failed: ScanProgress = {
        running: false,
        phase: 'failed',
        done: 0,
        total: 0,
        added: 0,
        updated: 0,
        moved: 0,
        missing: 0,
        unsupported: 0,
        errors: [error.message],
        finishedAt: Date.now(),
      };
      report(failed);
      return failed;
    })
    .finally(() => {
      running = undefined;
    });
  running = scan;
  return scan;
}

export const isScanning = () => running !== undefined;

/** The last scan's progress, for a page that opens while one runs */
export const latestScan = () => latest;
