/**
 * index.js
 *
 * Main project file
 *
 * node-persistent-queue
 *
 * 18/05/2019
 *
 * Copyright (C) 2019 Damien Clark (damo.clarky@gmail.com)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
*/


/**
 * @typdef {Object} PersistentQueue~Job
 * @property {number} id A sequenced identifier for the job
 * @property {Object} job An object containing arbitrary data for the job
 */

var EventEmitter = require('events').EventEmitter ;
var sqlite3 = require('sqlite3').verbose() ;

/**
 * Default queue table name for the sqlite db
 * @type {string}
 * @const
 * @default
 */
let table = 'queue' ;

/**
 * Default counter table name for the sqlite db
 * @type {string}
 * @const
 * @default
 */
let table_count = 'queue_count' ;

/**
 * Simple SQLite backed Queue for running many short tasks in Node.js
 *
 * @author Damien Clark <damo.clarky@gmail.com>
 * @param {string} [filename=:memory:] Path to sqlite db for queue db
 * @param {number} [batchSize=10] The number of rows from queue db to retrieve at a time
 * @constructor
 */
function PersistentQueue(filename, batchSize) {
	// Call super-constructor
	EventEmitter.call(this) ;

	// If filename not provided, then throw error
	if(filename === undefined)
		throw new Error('No filename parameter provided') ;

	/**
	 * Set to true to enable debugging mode
	 * @type {boolean}
	 * @access private
	 */
	this.debug = false ;

	/**
	 * Instance variable for whether the queue is empty (not known at instantiation)
	 * @type {boolean}
	 * @access private
	 */
	this.empty = undefined ;

	/**
	 * Path to the sqlite db file
	 * @type {string}
	 * @access private
	 */
	this.dbPath = (filename === '') ? ':memory:' : filename ;

	/**
	 * How many objects to retrieve from DB into queue array at a time
	 */
	this.batchSize = (batchSize === undefined) ? 10 : batchSize ;
	if(typeof this.batchSize !== 'number' || this.batchSize < 1)
		throw new Error('Invalid batchSize parameter.  Must be a number > 0') ;

	/**
	 * The queue of objects to operate on
	 * @type {Array}
	 * @access private
	 */
	this.queue = [] ;

	/**
	 * Keep track of total number of jobs in queue
	 * @type {number}
	 * @access private
	 */
	this.length  = null ;

	/**
	 * The sqlite database object handle
	 * @type {sqlite3.Database}
	 * @access private
	 */
	this.db = null ;

	/**
	 * The queue's sqlite database is open
	 * @type {boolean}
	 * @access private
	 */
	this.opened = false ;

	/**
	 * Should the queue process messages
	 * @type {boolean}
	 * @access private
	 */
	this.run = false ;

	this.on('start', () => {
		if(this.db === null)
			throw new Error('Open queue database before starting queue') ;

		if(this.run === false) {
			this.run = true ;
			this.emit('trigger_next') ;
		}
	}) ;

	this.on('stop', () => {
		this.run = false ;
	}) ;

	this.on('trigger_next', () => {
		if(this.debug) console.log('trigger_next') ;
		//Check state of queue
		if(!this.run || this.empty) {
			if(this.debug) console.log('run='+this.run+' and empty='+this.empty) ;
			if(this.debug) console.log('not started or empty queue') ;
			// If queue not started or is empty, then just return
			return ;
		}

		// Define our embedded recursive function to be called later
		const trigger = () => {
			this.emit('next', this.queue[0]) ;
		} ;

		// If our in-memory list is empty, but queue is not, re-hydrate from db
		if(this.queue.length === 0 && this.length !== 0) {

			hydrateQueue(this, this.batchSize)
			.then(() => {
				// Schedule job for next check phase in event loop
				setImmediate(trigger) ;
			})
			.catch(err => {
				console.error(err) ;
				process.exit(1) ;
			}) ;
		}
		else if(this.queue.length) { // If in-memory queue not empty, trigger next job
			// https://nodejs.org/en/docs/guides/event-loop-timers-and-nexttick/
			setImmediate(trigger) ;
		}
		else { // Otherwise queue is empty
			this.emit('empty') ;
		}
	}) ;

	// Set instance to empty on empty event
	this.on('empty', () => {
		this.empty = true ;
		// Ask sqlite to free up unused space
		this.db.exec("VACUUM;")
	}) ;

	// If a job is added, trigger_next event
	// eslint-disable-next-line no-unused-vars
	this.on('add', job => {
		if(this.empty) {
			this.empty = false ;
			if(this.debug) console.log('No longer empty') ;
			if(this.run)
				this.emit('trigger_next') ;
		}
	}) ;

	// eslint-disable-next-line no-unused-vars
	this.on('open', db => {
		this.opened = true ;
	}) ;

	// Unset the db variable when db is closed
	this.on('close', () => {
		this.opened = false ;
		this.db = null ;
		this.empty = undefined ;
		this.run = false ;
		this.queue = [] ;
	}) ;
}
PersistentQueue.prototype = Object.create(EventEmitter.prototype) ;

/**
 * Open sqlite database
 *
 * @return {Promise}
 */
PersistentQueue.prototype.open = function() {


	// return a promise from open method from:
	return new Promise((resolve, reject) => {
		// Opening db
		this.db = new sqlite3.Database(this.dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, err => {
			if(err !== null)
				reject(err) ;
			resolve() ;
		}) ;
	})
	.then(() => {
		// Puts the execution mode into serialized. This means that at most one statement object can execute a query
		// at a time. Other statements wait in a queue until the previous statements are executed.
		// If you call it without a function parameter, the execution mode setting is sticky and won't change until
		// the next call to Database#parallelize.
		// https://github.com/mapbox/node-sqlite3/wiki/Control-Flow#databaseserializecallback
		this.db.serialize() ;
		// Create and initialise tables if they doesnt exist
		return new Promise((resolve, reject) => {
			let query = ` 
			CREATE TABLE IF NOT EXISTS ${table} (id INTEGER PRIMARY KEY ASC AUTOINCREMENT, job TEXT) ; 
			
			CREATE TABLE IF NOT EXISTS ${table_count} (counter BIGINT) ; 
			
			INSERT INTO ${table_count} SELECT 0 as counter WHERE NOT EXISTS(SELECT * FROM ${table_count}) ; 
			
			UPDATE ${table_count} SET counter = (SELECT count(*) FROM ${table}) ; 
			
			CREATE TRIGGER IF NOT EXISTS queue_insert 
			AFTER INSERT 
			ON ${table} 
			BEGIN 
			UPDATE ${table_count} SET counter = counter + 1 ; 
			END; 
			
			CREATE TRIGGER IF NOT EXISTS queue_delete 
			AFTER DELETE 
			ON ${table} 
			BEGIN 
			UPDATE ${table_count} SET counter = counter - 1 ; 
			END; 
			` ;

			this.db.exec(query, err => {
				if(err !== null)
					reject(err) ;

				resolve() ;
			}) ;
		}) ;
	})
	.then(() => countQueue(this))
	.then(() => {
		// Load batchSize number of jobs from queue (if there are any)
		return hydrateQueue(this, this.batchSize)
		.then(jobs => {
			//If no msg left, set empty to true (but don't emit event)
			this.empty = (this.queue.length === 0) ;

			this.emit('open', this.db) ;
			return Promise.resolve(jobs) ;
		}) ;
	}) ;
} ;

/**
 * Close the sqlite database
 *
 * @return {Promise}
 */
PersistentQueue.prototype.close = function() {

	return new Promise((resolve, reject) => {
		setTimeout(() => {
			this.db.close(err => {
				if(err)
					reject(err) ;
				this.emit('close') ;
				resolve() ;
			}) ;
		}, 0) ;
	}) ;
} ;

/**
 * Get the total number of jobs in the queue
 *
 * @return {number} Total number of jobs left to run
 */
PersistentQueue.prototype.getLength = function() {
	return this.length ;
} ;

/**
 * Start processing the queue
 */
PersistentQueue.prototype.start = function() {
	this.emit('start') ;
} ;

/**
 * Stop processing the queue
 */
PersistentQueue.prototype.stop = function() {
	this.emit('stop') ;
} ;

/**
 * Called by user from within their 'next' event handler when finished
 *
 * It will remove the current  job from the sqlite queue and emit another 'next' event
 */
PersistentQueue.prototype.done = function() {

	if(this.debug) console.log('Calling done!') ;
	// Remove the job from the queue
	removeJob(this)
	.then(() => {
		if(this.debug) console.log('Job deleted from db') ;
		// Decrement our job length
		this.length-- ;
		this.emit('trigger_next') ;
	})
	.catch(err => {
		console.error(err) ;
		process.exit(1) ;
	}) ;
} ;

/**
 * Called by user from within their 'next' event handler when error occurred and job to remain at head of queue
 *
 * It will leave the current job in the queue and stop the queue
 */
PersistentQueue.prototype.abort = function() {

	if(this.debug) console.log('Calling abort!') ;
	this.stop() ;
} ;

/**
 * Called by user to add a job to the queue
 *
 * @param {Object} job Object to be serialized and added to queue via JSON.stringify()
 * @return {Promise<number>} Job id
 */
PersistentQueue.prototype.add = function(job) {

	const self = this ;

	return new Promise((resolve, reject) => {
		this.db.run('INSERT INTO ' + table + ' (job) VALUES (?)', JSON.stringify(job), function(err) {
			if(err)
				reject(err) ;

			// Increment our job length
			self.length++ ;

			self.emit('add', { id: this.lastID, job: job }) ;
			resolve(this.lastID) ;
		}) ;
	}) ;
} ;

/**
 * Turn on or off the debugging function. Off by default
 *
 * @param {boolean} debug True to turn on, false to turn off
 * @return {PersistentQueue} Instance for method chaining
 */
PersistentQueue.prototype.setDebug = function(debug) {
	this.debug = debug ;
	return this ;
} ;

/**
 * Is the persistent storage queue empty
 *
 * @throws {Error} If open method hasn't been called first
 *
 * @return {boolean} True if empty, false if jobs still remain
 */
PersistentQueue.prototype.isEmpty = function() {
	if(this.empty === undefined)
		throw new Error('Call open() method before calling isEmpty()') ;
	return this.empty ;
} ;

/**
 * Is the queue started and processing jobs
 *
 * @return {boolean} True if started, otherwise false
 */
PersistentQueue.prototype.isStarted = function() {
	return this.run ;
} ;

/**
 * Is the queue's SQLite DB open
 *
 * @return {boolean} True if opened, otherwise false
 */
PersistentQueue.prototype.isOpen = function() {
	return this.opened ;
} ;

/**
 * Get a reference to sqlite3 Database instance
 *
 * @throws {Error} If open method hasn't been called first
 * @return {sqlite3.Database}
 */
PersistentQueue.prototype.getSqlite3 = function() {
	if(this.db === null)
		throw new Error('Call open() method before calling getSqlite3()') ;
	return this.db ;
} ;

/**
 * Returns true if there is a job with 'id' still in queue, otherwise false
 * @param {number} id The job id to search for
 * @return {Promise<boolean>} Promise resolves true if the job id is still in the queue, otherwise false
 */
PersistentQueue.prototype.has = function(id) {

	// First search the in-memory queue as its quick
	return new Promise((reject, resolve) => {
		for(let i=0 ; i<this.queue.length ; i++) {
			if(this.queue[i].id === id)
				resolve(true) ;
		}
		// Now check the on-disk queue
		this.db.get('SELECT id FROM ' + table + ' where id = ?', id, (err, row) => {
			if(err !== null)
				reject(err) ;

			// Return true if there is a record, otherwise return false
			resolve(row !== undefined) ;
		}) ;
	}) ;
} ;

/**
 * Return an array of job id numbers matching the given job data in order of execution
 * @param {object} job
 * @return {Promise<number[]>}
 */
PersistentQueue.prototype.getJobIds = function(job) {
	return searchQueue(this, job) ;
} ;

/**
 * Return an array of job id numbers matching the given job data in order of execution
 * @param {object} job
 * @return {Promise<number>}
 */
PersistentQueue.prototype.getFirstJobId = function(job) {

	// eslint-disable-next-line no-unused-vars
	return new Promise((resolve, reject) => {
		// search in-memory queue first
		let jobstr = JSON.stringify(job) ;
		// console.warn(`jobstr=${jobstr}`);
		let i = this.queue.findIndex(j => {
			// console.warn(`job=${JSON.stringify(j)}`);
			return (JSON.stringify(j.job) === jobstr) ;
		}) ;
		if (i !== -1) {
			resolve(this.queue[i].id) ;
			return ;
		}
		// Otherwise have to search rest of db queue
		searchQueue(this, job)
		.then(data => {
			if (data.length === 0) {
				resolve(null) ;
				return ;
			}
			resolve(data[0]) ;
		}) ;
	}) ;
} ;


/**
 * Delete a job from the queue (if it exists)
 * @param {number} id The job id number to delete
 * @return {Promise<number>} The id number that was deleted
 */
PersistentQueue.prototype.delete = function(id) {

	return new Promise((resolve, reject) => {
		removeJob(this, id)
		.then(() => {
			if(this.debug) console.log('Job deleted from db') ;
			this.emit('delete', { id: id }) ;
			// Decrement our job length
			this.length-- ;
			resolve(id) ;
		})
		.catch(reject) ;
	}) ;
} ;

function countQueue(q) {
	if(q.debug) console.log('CountQueue') ;
	return new Promise((resolve, reject) => {
		if(q.db === null)
			reject('Open queue database before counting jobs') ;

		q.db.get('SELECT counter FROM ' + table_count + ' LIMIT 1', (err, row) => {
			if(err !== null)
				reject(err) ;

			// Set length property to number of rows in sqlite table
			q.length = row.counter ;
			resolve(this.length) ;
		}) ;
	}) ;
}

function searchQueue(q, job) {

	if(q.debug) console.log('SearchQueue') ;
	return new Promise((resolve, reject) => {
		if(q.db === null)
			reject('Open queue database before starting queue') ;

		q.db.all(`SELECT id FROM ${table} where job = ? ORDER BY id ASC`, JSON.stringify(job), (err, jobs) => {
			if(err !== null)
				reject(err) ;

			jobs = jobs.map(j => j.id) ;

			if(q.debug) {
				for(let i = 0 ; i < jobs.length ; i++)
					if(q.debug) console.log(JSON.stringify(jobs[i])) ;

			}
			resolve(jobs) ;
		}) ;
	}) ;
}

/**
 * This function will load from the database, 'size' number of records into queue array
 * @param {PersistentQueue} q Instance of queue
 * @param size How many records to hydrate
 */
function hydrateQueue(q, size) { // eslint-disable-line no-unused-vars

	if(q.debug) console.log('HydrateQueue') ;
	return new Promise((resolve, reject) => {
		if(q.db === null)
			reject('Open queue database before starting queue') ;

		q.db.all('SELECT * FROM ' + table + ' ORDER BY id ASC LIMIT ' + q.batchSize, (err, jobs) => {
			if(err !== null)
				reject(err) ;

			if(q.debug) {
				for(let i = 0 ; i < jobs.length ; i++)
					if(q.debug) console.log(JSON.stringify(jobs[i])) ;

			}
			// Update our queue array (converting stored string back to object using JSON.parse
			q.queue = jobs.map(job => {
				try {
					return { id: job.id, job: JSON.parse(job.job)} ;
				}
				catch(err) {
					reject(err) ;
				}
			}) ;

			resolve(jobs) ;
		}) ;
	}) ;
}

/**
 * This function will remove the given or current job from the database and in-memory array
 * @param {PersistentQueue} q Instance to work with
 * @param {number} [id] Optional job id number to remove, if omitted, remove current job at front of queue
 * @return {Promise}
 */
function removeJob(q, id) {
	if(id === undefined) {
		id = q.queue.shift().id ;
	}
	else {
		// Search queue for id and remove if exists
		for(let i=0 ; i<q.queue.length ; i++) {
			if(q.queue[i].id === id) {
				q.queue.splice(i, 1) ;
				break ;
			}
		}
	}

	return new Promise((resolve, reject) => {
		if(q.db === null)
			reject('Open queue database before starting queue') ;

		if(q.debug) console.log('About to delete') ;
		if(q.debug) console.log('Removing job: '+id) ;
		if(q.debug) console.log('From table: '+table) ;
		if(q.debug) console.log('With queue length: '+q.length) ;
		q.db.run('DELETE FROM ' + table + ' WHERE id = ?', id, function(err) {
			if(err !== null)
				reject(err) ;

			if(this.changes) // Number of rows affected (0 == false)
				resolve(id) ;

			reject('Job id '+id+' was not removed from queue') ;
		}) ;
	}) ;
}

module.exports = PersistentQueue ;
