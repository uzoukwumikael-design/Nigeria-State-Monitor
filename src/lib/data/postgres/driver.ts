export type DatabaseRow = Record<string, unknown>;

export interface QueryExecutor {
  query<T = DatabaseRow>(sql: string, params?: readonly unknown[]): Promise<{ rows: T[] }>;
  exec(sql: string): Promise<void>;
}

export interface DatabaseDriver extends QueryExecutor {
  transaction<T>(work: (tx: QueryExecutor) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
