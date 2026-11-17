import { goto } from '$app/navigation';

/**
 * The library list someone left to open a doujin: its address (search, filter, sort), what it
 * showed, and how far down it was scrolled. The doujin's page links back to exactly that list,
 * and the list scrolls back to where it was.
 */
export type LibraryPlace = { url: string; heading: string; scrollY: number };

class LibraryReturn {
  place = $state<LibraryPlace | undefined>();

  remember(place: LibraryPlace) {
    this.place = place;
  }

  /**
   * The scroll position to go back to, if the list is the one that was left. Any visit to the list
   * uses it up, so a later visit to the same address keeps its own position.
   */
  takeScroll(url: string) {
    const place = this.place;
    if (!place || place.url !== url) return undefined;
    const { scrollY } = place;
    this.place = { ...place, scrollY: 0 };
    return scrollY || undefined;
  }
}

export const libraryReturn = new LibraryReturn();

/** Opens the list the doujin was opened from, scrolled back to where it was */
export function openRememberedList() {
  return goto(libraryReturn.place?.url ?? '/', { state: { returning: true } });
}

/** A click the browser should handle itself: opening the link in a new tab or window */
export const opensElsewhere = (event: MouseEvent) =>
  event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey;
