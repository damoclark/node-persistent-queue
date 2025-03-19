import { EventEmitter } from "events";
import { Database } from "sqlite3";

interface Task<T> {
  id: number;
  job: T;
}

export default class PersistentQueue<T> extends EventEmitter {
  constructor(filename: string, batchSize?: number);

  debug: boolean;
  empty: boolean | undefined;
  dbPath: string;
  batchSize: number;
  queue: Task<T>[];
  length: number | null;
  db: Database;
  opened: boolean;
  run: boolean;

  on(event: "open", listener: (db: Database) => void): this;
  on(event: "close", listener: () => void): this;
  on(event: "start", listener: () => void): this;
  on(event: "stop", listener: () => void): this;
  on(event: "trigger_next", listener: () => void): this;
  on(event: "empty", listener: () => void): this;
  on(event: "add", listener: (task: Task<T>) => void): this;
  on(event: "delete", listener: (info: { id: number }) => void): this;
  on(event: "next", listener: (task: Task<T>) => void): this;

  open(): Promise<void>;
  close(): Promise<void>;
  getLength(): number;
  start(): void;
  stop(): void;
  done(): void;
  abort(): void;
  add(job: T): Promise<number>;
  setDebug(debug: boolean): this;
  isEmpty(): boolean;
  isStarted(): boolean;
  isOpen(): boolean;
  getSqlite3(): Database;
  has(id: number): Promise<boolean>;
  getJobIds(job: object): Promise<number[]>;
  getFirstJobId(job: object): Promise<number | null>;
  delete(id: number): Promise<number>;
}
