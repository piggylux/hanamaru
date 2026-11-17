/**
 * A failure the page shows as it is, such as a duplicate collection name. Thrown in the engine's
 * worker and rebuilt on the page with the same message and code.
 */
export class EngineError extends Error {
  constructor(
    message: string,
    readonly code?: string
  ) {
    super(message);
  }
}
