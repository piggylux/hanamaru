import sqlite3InitModule, {
  type Database as WasmDb,
  type PreparedStatement,
} from '@sqlite.org/sqlite-wasm';

import {
  prepareDatabase,
  type Database,
  type RunResult,
  type SqlValue,
  type Statement,
} from './db.js';

type Sqlite3 = Awaited<ReturnType<typeof sqlite3InitModule>>;

/**
 * The library database, kept in the site's private storage (OPFS). The "SAH pool" storage needs a
 * dedicated worker and no special server headers, which is why the whole engine runs in one.
 */
export async function openBrowserDatabase(name = 'library.db'): Promise<Database> {
  const sqlite3 = await sqlite3InitModule();
  const pool = await installPool(sqlite3);
  const db = new pool.OpfsSAHPoolDb(`/${name}`);
  return prepareDatabase(new WasmDatabase(sqlite3, db));
}

/**
 * The storage pool needs its files to itself. Right after a reload, the previous page's worker
 * can still hold them for a moment, so opening is tried again a few times before giving up.
 */
async function installPool(sqlite3: Sqlite3) {
  type Options = Parameters<Sqlite3['installOpfsSAHPoolVfs']>[0];
  for (let attempt = 1; ; attempt++) {
    try {
      return await sqlite3.installOpfsSAHPoolVfs({
        name: 'hanamaru',
        initialCapacity: 8,
        // A failed try lets go of the files it took, and keeps the library's data
        preserveOnInitFailure: true,
        forceReinitIfPreviouslyFailed: attempt > 1,
      } as Options);
    } catch (error) {
      if (attempt >= 6) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 250));
    }
  }
}

/**
 * A connection that only lives in memory, for checks in the browser. With `bytes`, it starts as a
 * copy of that database file.
 */
export async function openMemoryDatabase(bytes?: Uint8Array): Promise<Database> {
  const sqlite3 = await sqlite3InitModule();
  const db = new sqlite3.oo1.DB(':memory:', 'c');
  if (bytes) {
    const { capi, wasm } = sqlite3;
    const data = wasm.allocFromTypedArray(bytes);
    const flags = capi.SQLITE_DESERIALIZE_FREEONCLOSE | capi.SQLITE_DESERIALIZE_RESIZEABLE;
    db.checkRc(
      capi.sqlite3_deserialize(db.pointer!, 'main', data, bytes.length, bytes.length, flags)
    );
  }
  return prepareDatabase(new WasmDatabase(sqlite3, db));
}

/** The browser's SQLite behind the same small interface as Bun's */
class WasmDatabase implements Database {
  #statements = new Map<string, PreparedStatement>();
  #depth = 0;

  constructor(
    readonly sqlite3: Sqlite3,
    readonly db: WasmDb
  ) {}

  query<Row, Params extends SqlValue[]>(sql: string): Statement<Row, Params> {
    let statement = this.#statements.get(sql);
    if (!statement) {
      statement = this.db.prepare(sql);
      this.#statements.set(sql, statement);
    }
    return new WasmStatement<Row, Params>(this, statement);
  }

  run(sql: string) {
    this.db.exec(sql);
  }

  transaction<Args extends unknown[], Result>(work: (...args: Args) => Result) {
    return (...args: Args) => {
      const savepoint = this.#depth > 0 ? `nested_${this.#depth}` : undefined;
      this.db.exec(savepoint ? `SAVEPOINT ${savepoint}` : 'BEGIN');
      this.#depth++;
      try {
        const result = work(...args);
        this.#depth--;
        this.db.exec(savepoint ? `RELEASE ${savepoint}` : 'COMMIT');
        return result;
      } catch (error) {
        this.#depth--;
        this.db.exec(savepoint ? `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}` : 'ROLLBACK');
        throw error;
      }
    };
  }

  close() {
    for (const statement of this.#statements.values()) statement.finalize();
    this.#statements.clear();
    this.db.close();
  }

  lastInsertRowid() {
    const id = this.sqlite3.capi.sqlite3_last_insert_rowid(this.db.pointer!);
    return id <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(id) : id;
  }
}

/** Booleans become 1 and 0, as Bun stores them */
const bindable = (params: SqlValue[]) =>
  params.map((value) => (typeof value === 'boolean' ? Number(value) : value)) as Exclude<
    SqlValue,
    boolean
  >[];

class WasmStatement<Row, Params extends SqlValue[]> implements Statement<Row, Params> {
  constructor(
    readonly owner: WasmDatabase,
    readonly statement: PreparedStatement
  ) {}

  #bind(params: SqlValue[]) {
    if (params.length) this.statement.bind(bindable(params));
  }

  all(...params: Params): Row[] {
    try {
      this.#bind(params);
      const rows: Row[] = [];
      while (this.statement.step()) rows.push(this.statement.get({}) as Row);
      return rows;
    } finally {
      this.statement.reset(true);
    }
  }

  get(...params: Params): Row | null {
    try {
      this.#bind(params);
      return this.statement.step() ? (this.statement.get({}) as Row) : null;
    } finally {
      this.statement.reset(true);
    }
  }

  run(...params: Params): RunResult {
    try {
      this.#bind(params);
      while (this.statement.step()) {
        // Statements that return rows are run to the end, as Bun does
      }
      return {
        changes: Number(this.owner.db.changes()),
        lastInsertRowid: this.owner.lastInsertRowid(),
      };
    } finally {
      this.statement.reset(true);
    }
  }
}
