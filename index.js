/**
 * index.js
 *
 * Main project file
 *
 * node-persistent-queue
 *
 * 23/5/17
 *
 * Copyright (C) 2017 Damien Clark (damo.clarky@gmail.com)
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

/**
 * @typdef {Object} PersistentQueue~Job
 * @property {integer} id A sequenced identifier for the job
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
var table = 'queue' ;

/**
 * Default counter table name for the sqlite db
 * @type {string}
 * @const
 * @default
 */
var table_count = 'queue_count' ;

/**
 * Simple SQLite backed Queue for running many short tasks in Node.js
 *
 * @author Damien Clark <damo.clarky@gmail.com>
 * @param {string} [filename=:memory:] Path to sqlite db for queue db
 * @param {integer} [batchSize=10] The number of rows from queue db to retrieve at a time
 * @constructor
 */
function PersistentQueue(filename, batchSize) {
	// Call super-constructor
	EventEmitter.call(this) ;

	// Copy our instance for closures
	var self = this ;

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
	 * @type {integer}
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

	this.on('start', function() {
		if(self.db === null)
			throw new Error('Open queue database before starting queue') ;

		if(self.run === false) {
			self.run = true ;
			self.emit('trigger_next') ;
		}
	}) ;

	this.on('stop', function() {
		self.run = false ;
	}) ;

	this.on('trigger_next', function() {
		if(self.debug) console.log('trigger_next') ;
		//Check state of queue
		if(!self.run || self.empty) {
			if(self.debug) console.log('run='+self.run+' and empty='+self.empty) ;
			if(self.debug) console.log('not started or empty queue') ;
			// If queue not started or is empty, then just return
			return ;
		}

		// Define our embedded recursive function to be called later
		function trigger() {
			self.emit('next', self.queue[0]) ;
		}

		// If our in-memory list is empty, but queue is not, re-hydrate from db
		if(self.queue.length === 0 && self.length !== 0) {

			hydrateQueue(this, this.batchSize)
			.then(function() {
				// Schedule job for next check phase in event loop
				setImmediate(trigger) ;
			})
			.catch(function(err) {
				console.error(err) ;
				process.exit(1) ;
			}) ;
		}
		else if(self.queue.length) { // If in-memory queue not empty, trigger next job
			// https://nodejs.org/en/docs/guides/event-loop-timers-and-nexttick/
			setImmediate(trigger) ;
		}
		else { // Otherwise queue is empty
			self.emit('empty') ;
		}
	}) ;

	// Set instance to empty on empty event
	this.on('empty', function() {
		self.empty = true ;
	}) ;

	// If a job is added, trigger_next event
	// eslint-disable-next-line no-unused-vars
	this.on('add', function(job) {
		if(self.empty) {
			self.empty = false ;
			if(self.debug) console.log('No longer empty') ;
			if(self.run)
				self.emit('trigger_next') ;
		}
	}) ;

	// eslint-disable-next-line no-unused-vars
	this.on('open', function(db) {
		self.opened = true ;
	}) ;

	// Unset the db variable when db is closed
	this.on('close', function() {
		self.opened = false ;
		self.db = null ;
		self.empty = undefined ;
		self.run = false ;
		self.queue = [] ;
	}) ;
}
PersistentQueue.prototype = Object.create(EventEmitter.prototype) ;

/**
 * Open sqlite database
 *
 * @return {Promise}
 */
PersistentQueue.prototype.open = function open() {
	var self = this ;

	// return a promise from open method from:
	return new Promise(function(resolve, reject) {
		// Opening db
		self.db = new sqlite3.Database(self.dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, function(err) {
			if(err !== null)
				reject(err) ;
			resolve() ;
		}) ;
	})
	.then(function() {
		// Puts the execution mode into serialized. This means that at most one statement object can execute a query
		// at a time. Other statements wait in a queue until the previous statements are executed.
		// If you call it without a function parameter, the execution mode setting is sticky and won't change until
		// the next call to Database#parallelize.
		// https://github.com/mapbox/node-sqlite3/wiki/Control-Flow#databaseserializecallback
		self.db.serialize() ;
		// Create and initialise tables if they doesnt exist
		return new Promise(function(resolve, reject) {
			var query = ' \
			CREATE TABLE IF NOT EXISTS ' + table + ' (id INTEGER PRIMARY KEY ASC AUTOINCREMENT, job TEXT) ; \
			\
			CREATE TABLE IF NOT EXISTS ' + table_count + ' (counter BIGINT) ; \
			\
			INSERT INTO ' + table_count + ' SELECT 0 as counter WHERE NOT EXISTS(SELECT * FROM ' + table_count + ') ; \
			\
			UPDATE ' + table_count + ' SET counter = (SELECT count(*) FROM ' + table + ') ; \
			\
			CREATE TRIGGER IF NOT EXISTS queue_insert \
			AFTER INSERT \
			ON ' + table + ' \
			BEGIN \
			UPDATE ' + table_count + ' SET counter = counter + 1 ; \
			END; \
			\
			CREATE TRIGGER IF NOT EXISTS queue_delete \
			AFTER DELETE \
			ON ' + table + ' \
			BEGIN \
			UPDATE ' + table_count + ' SET counter = counter - 1 ; \
			END; \
			' ;

			self.db.exec(query, function(err) {
				if(err !== null)
					reject(err) ;

				resolve() ;
			}) ;
		}) ;
	})
	.then(function() {
		return countQueue(self) ;
	})
	.then(function() {
		// Load batchSize number of jobs from queue (if there are any)
		return hydrateQueue(self, self.batchSize)
		.then(function(jobs) {
			//If no msg left, set empty to true (but don't emit event)
			self.empty = (self.queue.length === 0) ;

			self.emit('open', self.db) ;
			return Promise.resolve(jobs) ;
		}) ;
	}) ;
} ;

/**
 * Close the sqlite database
 *
 * @return {Promise}
 */
PersistentQueue.prototype.close = function close() {
	var self = this ;
	return new Promise(function(resolve, reject) {
		self.db.close(function(err) {
			if(err)
				reject(err) ;
			self.emit('close') ;
			resolve() ;
		}) ;
	}) ;
} ;

/**
 * Get the total number of jobs in the queue
 *
 * @return {integer} Total number of jobs left to run
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
	var self = this ;
	if(self.debug) console.log('Calling done!') ;
	// Remove the job from the queue
	removeJob(this)
	.then(function() {
		if(self.debug) console.log('Job deleted from db') ;
		// Decrement our job length
		self.length-- ;
		self.emit('trigger_next') ;
	})
	.catch(function(err) {
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
	var self = this ;
	if(self.debug) console.log('Calling abort!') ;
	self.stop() ;
} ;

/**
 * Called by user to add a job to the queue
 *
 * @param {Object} job Object to be serialized and added to queue via JSON.stringify()
 * @return {Promise<integer>} Job id
 */
PersistentQueue.prototype.add = function(job) {
	var self = this ;

	return new Promise(function(resolve, reject) {
		self.db.run('INSERT INTO ' + table + ' (job) VALUES (?)', JSON.stringify(job), function(err) {
			if(err)
				reject(err) ;

			// Increment our job length
			self.length++ ;

			self.emit('add', { id: this.lastID, job: job }) ;
			resolve(this.id) ;
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
 * @param {integer} id The job id to search for
 * @return {Promise} Promise resolves true if the job id is still in the queue, otherwise false
 */
PersistentQueue.prototype.has = function(id) {
	var self = this ;
	// First search the in-memory queue as its quick
	return new Promise(function(reject, resolve) {
		for(var i=0 ; i<self.queue.length ; i++) {
			if(self.queue[i].id === id)
				resolve(true) ;
		}
		// Now check the on-disk queue
		this.db.get('SELECT id FROM ' + table + ' where id = ?', id, function(err, row) {
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
 * @return {Promise<array>}
 */
PersistentQueue.prototype.getJobIds = function(job) {
	return searchQueue(this, job) ;
} ;

/**
 * Return an array of job id numbers matching the given job data in order of execution
 * @param {object} job
 * @return {Promise<array>}
 */
PersistentQueue.prototype.getFirstJobId = function(job) {
	var self = this ;
	// eslint-disable-next-line no-unused-vars
	return new Promise(function(resolve, reject) {
		// search in-memory queue first
		var jobstr = JSON.stringify(job) ;
		// console.warn(`jobstr=${jobstr}`);
		var i = self.queue.findIndex(function(j) {
			// console.warn(`job=${JSON.stringify(j)}`);
			return (JSON.stringify(j.job) === jobstr) ;
		}) ;
		if (i !== -1) {
			resolve(self.queue[i].id) ;
			return ;
		}
		// Otherwise have to search rest of db queue
		searchQueue(self, job)
		.then(function(data){
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
 * @param {integer} id The job id number to delete
 */
PersistentQueue.prototype.delete = function(id) {
	var self = this ;
	return removeJob(this, id)
	.then(function() {
		if(self.debug) console.log('Job deleted from db') ;
		self.emit('delete', { id: id }) ;
		// Decrement our job length
		self.length-- ;
	}) ;
} ;

function countQueue(self) {
	if(self.debug) console.log('CountQueue') ;
	return new Promise(function(resolve, reject) {
		if(self.db === null)
			reject('Open queue database before counting jobs') ;

		self.db.get('SELECT counter FROM ' + table_count + ' LIMIT 1', function(err, row) {
			if(err !== null)
				reject(err) ;

			// Set length property to number of rows in sqlite table
			self.length = row.counter ;
			resolve(this.length) ;
		}) ;
	}) ;
}

function searchQueue(self, job) {

	if(self.debug) console.log('SearchQueue') ;
	return new Promise(function(resolve, reject) {
		if(self.db === null)
			reject('Open queue database before starting queue') ;

		self.db.all('SELECT id FROM ' + table + ' where job =\'' + JSON.stringify(job) + '\' ORDER BY id ASC', function(err, jobs) {
			if(err !== null)
				reject(err) ;

			jobs = jobs.map(function(j){
				return j.id ;
			}) ;

			if(self.debug) {
				for(var i = 0 ; i < jobs.length ; i++) 
					if(self.debug) console.log(JSON.stringify(jobs[i])) ;
				
			}
			resolve(jobs) ;
		}) ;
	}) ;
}

/**
 * This function will load from the database, 'size' number of records into queue array
 * @param {PersistentQueue} self Instance of queue
 * @param size How many records to hydrate
 */
function hydrateQueue(self, size) { // eslint-disable-line no-unused-vars

	if(self.debug) console.log('HydrateQueue') ;
	return new Promise(function(resolve, reject) {
		if(self.db === null)
			reject('Open queue database before starting queue') ;

		self.db.all('SELECT * FROM ' + table + ' ORDER BY id ASC LIMIT ' + self.batchSize, function(err, jobs) {
			if(err !== null)
				reject(err) ;

			if(self.debug) {
				for(var i = 0 ; i < jobs.length ; i++) 
					if(self.debug) console.log(JSON.stringify(jobs[i])) ;
				
			}
			// Update our queue array (converting stored string back to object using JSON.parse
			self.queue = jobs.map(function(job){
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
 * @param {PersistentQueue} self Instance to work with
 * @param {integer} [id] Optional job id number to remove, if omitted, remove current job at front of queue
 * @return {Promise}
 */
function removeJob(self, id) {
	if(id === undefined) {
		id = self.queue.shift().id ;
	}
	else {
		// Search queue for id and remove if exists
		for(var i=0 ; i<self.queue.length ; i++) {
			if(self.queue[i].id === id) {
				self.queue.splice(i, 1) ;
				break ;
			}
		}
	}

	return new Promise(function(resolve, reject) {
		if(self.db === null)
			reject('Open queue database before starting queue') ;

		if(self.debug) console.log('About to delete') ;
		if(self.debug) console.log('Removing job: '+id) ;
		if(self.debug) console.log('From table: '+table) ;
		if(self.debug) console.log('With queue length: '+self.length) ;
		self.db.run('DELETE FROM ' + table + ' WHERE id = ?', id, function(err) {
			if(err !== null)
				reject(err) ;

			if(this.changes) // Number of rows affected (0 == false)
				resolve(id) ;

			reject('Job id '+id+' was not removed from queue') ;
		}) ;
	}) ;
}

module.exports = PersistentQueue ;
