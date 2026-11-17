import type { AppEvent, ScanProgress } from '#lib/types.js';

/**
 * Background work the engine reports as it happens. `libraryVersion` goes up whenever the
 * library changed, so lists can reload.
 */
class Live {
  scan = $state<ScanProgress | undefined>();
  libraryVersion = $state(0);

  receive(event: AppEvent) {
    if (event.type === 'scan') this.scan = event.progress;
    else if (event.type === 'library') this.libraryVersion++;
  }
}

export const live = new Live();
