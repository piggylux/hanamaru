// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
  namespace App {
    interface Error {
      message: string;
      /** Why the engine can't run here: `unsupported`, `busy` or `failed` */
      code?: string;
    }
    interface PageState {
      /** Set when a doujin's page goes back to the list it was opened from */
      returning?: boolean;
      /** Set on a doujin's page when the history entry before it is the list it was opened from */
      fromList?: boolean;
    }
  }
}

export {};
