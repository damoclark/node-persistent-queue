export = PersistentQueue;
/**
 * Simple SQLite backed Queue for running many short tasks in Node.js
 *
 * @author Damien Clark <damo.clarky@gmail.com>
 * @param {string} [filename=:memory:] Path to sqlite db for queue db
 * @param {number} [batchSize=10] The number of rows from queue db to retrieve at a time
 * @constructor
 */
declare function PersistentQueue(filename?: string, batchSize?: number): void;
declare class PersistentQueue {
    /**
     * Simple SQLite backed Queue for running many short tasks in Node.js
     *
     * @author Damien Clark <damo.clarky@gmail.com>
     * @param {string} [filename=:memory:] Path to sqlite db for queue db
     * @param {number} [batchSize=10] The number of rows from queue db to retrieve at a time
     * @constructor
     */
    constructor(filename?: string, batchSize?: number);
    /**
     * Set to true to enable debugging mode
     * @type {boolean}
     * @access private
     */
    debug: boolean;
    /**
     * Instance variable for whether the queue is empty (not known at instantiation)
     * @type {boolean}
     * @access private
     */
    empty: boolean;
    /**
     * Path to the sqlite db file
     * @type {string}
     * @access private
     */
    dbPath: string;
    /**
     * How many objects to retrieve from DB into queue array at a time
     */
    batchSize: number;
    /**
     * The queue of objects to operate on
     * @type {Array}
     * @access private
     */
    queue: any[];
    /**
     * Keep track of total number of jobs in queue
     * @type {number}
     * @access private
     */
    length: number;
    /**
     * The sqlite database object handle
     * @type {sqlite3.Database}
     * @access private
     */
    db: any;
    /**
     * The queue's sqlite database is open
     * @type {boolean}
     * @access private
     */
    opened: boolean;
    /**
     * Should the queue process messages
     * @type {boolean}
     * @access private
     */
    run: boolean;
    open(): Promise<any>;
    close(): Promise<any>;
    getLength(): number;
    start(): void;
    stop(): void;
    done(): void;
    abort(): void;
    add(job: any): Promise<number>;
    setDebug(debug: boolean): PersistentQueue;
    isEmpty(): boolean;
    isStarted(): boolean;
    isOpen(): boolean;
    getSqlite3(): any;
    has(id: number): Promise<boolean>;
    getJobIds(job: object): Promise<number[]>;
    getFirstJobId(job: object): Promise<number>;
    delete(id: number): Promise<number>;
}
