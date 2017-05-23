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
var sqlite3 = require('sqlite3').verbose();

/**
 * A simple queue object with persistent storage using sqlite
 *
 * @author Damien Clark <damo.clarky@gmail.com>
 * @param {string} [filename=:memory:] Path to sqlite db for queue db
 * @param {integer} [batchSize=10] The number of rows from queue db to retrieve at a time
 * @constructor
 */
function PersistentQueue(filename,batchSize) {
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
	 * Default table name for the sqlite db
	 * @type {string}
	 * @access private
	 */
	this.table = 'queue' ;

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

	this.on('start',function() {
		if(self.db === null)
			throw new Error('Open queue database before starting queue') ;

		if(self.run === false) {
			self.run = true ;
			self.emit('trigger_next') ;
		}
	}) ;

	this.on('stop',function() {
		self.run = false ;
	}) ;

	this.on('trigger_next',function() {
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
			self.emit('next',self.queue[0]) ;
		}

		// If our in-memory list is empty, re-hydrate from db
		if(self.queue.length === 0) {

			hydrateQueue(this,this.batchSize)
			.then(function() {
				// Schedule job for next check phase in event loop (if there is one)
				if(self.queue.length) {
					setImmediate(trigger) ;
				}
				else {
					self.emit('empty') ;
				}
			})
			.catch(function(err) {
				console.error(err) ;
				process.exit(1) ;
			}) ;
		} else {
			// https://nodejs.org/en/docs/guides/event-loop-timers-and-nexttick/
			setImmediate(trigger) ;
		}
	}) ;

	// Set instance to empty on empty event
	this.on('empty',function() {
		self.empty = true ;
	}) ;

	// If a job is added, trigger_next event
	this.on('add',function(job) {
		if(self.empty) {
			self.empty = false ;
			if(self.debug) console.log('No longer empty') ;
			if(self.run)
				self.emit('trigger_next') ;
		}
	}) ;

	this.on('open',function(db) {
		self.opened = true ;
	}) ;

	// Unset the db variable when db is closed
	this.on('close',function() {
		self.opened = false ;
		self.db = null ;
		self.empty = undefined ;
		self.run = false ;
		self.queue = [] ;
	}) ;
}
PersistentQueue.prototype = Object.create(EventEmitter.prototype) ;

// /**
//  * TODO This needs to be implemented in spool
//  */
// this.on('next',function(msg) {
// 	//Get the next message from db (order by id limit 1)
//
// 	//node.send(msg)
// 	//delete message from db (where id = )
// 	//emit ’next’ event on queue
//
// }) ;

// /**
//  * TODO This needs to be implemented in spool (stop queue when its empty)
//  */
// this.on('empty',function() {
// 	queue.stop() ;
// }) ;

/**
 * Open sqlite database
 *
 * @return {Promise}
 */
PersistentQueue.prototype.open = function open() {
	var self = this ;

	// return a promise from open method from:
	return new Promise(function(resolve,reject) {
		// Opening db
		self.db = new sqlite3.Database(self.dbPath,sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE,function(err) {
			if(err !== null)
				reject(err) ;
			resolve() ;
		}) ;
	})
	.then(function() {
		// Create table if it doesnt exist
		return new Promise(function(resolve2,reject2) {
			self.db.run("CREATE TABLE IF NOT EXISTS " + self.table + " (id INTEGER PRIMARY KEY ASC AUTOINCREMENT, job TEXT)",function(err) {
				if(err !== null)
					reject2(err) ;

				resolve2() ;
			});
		}) ;
	})
	.then(function() {
		// Load batchSize number of jobs from queue (if there are any)
		return hydrateQueue(self,self.batchSize)
		.then(function(jobs) {
			//If no msg left, set empty to true (but don't emit event)
			if(self.queue.length === 0) {
				self.empty = true ;
			}
			self.emit('open',self.db) ;
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
	return new Promise(function(resolve,reject) {
		self.db.close(function(err) {
			if(err)
				reject(err) ;
			self.emit('close') ;
			resolve() ;
		}) ;
	}) ;
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
		self.emit('trigger_next') ;
	})
	.catch(function(err) {
		console.error(err) ;
		process.exit(1) ;
	}) ;
} ;

/**
 * Called by user to add a job to the queue
 *
 * @param {Object} job Object to be serialized and added to queue via JSON.stringify()
 * @return {PersistentQueue} Instance for method chaining
 */
PersistentQueue.prototype.add = function(job) {
	var self = this ;

	self.db.run("INSERT INTO " + this.table + " (job) VALUES (?)", JSON.stringify(job), function(err) {
		if(err)
			throw err ;

		self.emit('add',{ id:this.lastID, job: job }) ;
	});
	return self ;
} ;

/**
 * Turn on or off the debugging function. Off by default
 *
 * @param {boolean} debug True to turn on, false to turn off
 */
PersistentQueue.prototype.setDebug = function(debug) {
	this.debug = debug ;
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
		throw new Error("Call open() method before calling isEmpty()") ;
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
		throw new Error("Call open() method before calling getSqlite3()") ;
	return this.db ;
} ;

/**
 * This function will load from the database, 'size' number of records into queue array
 * @param size
 */
function hydrateQueue(self,size) {

	if(self.debug) console.log('HydrateQueue') ;
	return new Promise(function(resolve,reject) {
		if(self.db === null)
			reject('Open queue database before starting queue') ;

		self.db.all("SELECT * FROM " + self.table + " ORDER BY id ASC LIMIT " + self.batchSize, function(err, jobs) {
			if(err !== null)
				reject(err) ;

			if(self.debug) console.log('Outputting queue:') ;
			for(var i = 0; i < jobs.length; i++) {
				if(self.debug) console.log(JSON.stringify(jobs[i])) ;
			}
			// Update our queue array (converting stored string back to object using JSON.parse
			self.queue = jobs.map(function(job){
				try {
					return { id: job.id, job: JSON.parse(job.job)} ;
				} catch(err) {
					reject(err) ;
				}
			}) ;

			resolve(jobs) ;
		}) ;
	}) ;
}

/**
 * This function will remove the current job from the database and in-memory array
 * @param {PersistentQueue} self Instance to work with
 * @return {Promise}
 */
function removeJob(self) {
	var job = self.queue.shift() ;

	return new Promise(function(resolve,reject) {
		if(self.db === null)
			reject('Open queue database before starting queue') ;

		if(self.debug) console.log('About to delete') ;
		if(self.debug) console.log('Removing job: '+JSON.stringify(job)) ;
		if(self.debug) console.log('From table: '+self.table) ;
		if(self.debug) console.log('With id: '+job.id) ;
		if(self.debug) console.log('With queue length: '+self.queue.length) ;
		self.db.run("DELETE FROM " + self.table + " WHERE id = ?", job.id, function(err) {
			if(err !== null)
				reject(err) ;

			if(this.changes) // Number of rows affected (0 == false)
				resolve(job.id) ;

			reject("Job id "+job.id+" was not removed from queue") ;
		});
	}) ;
}

module.exports = PersistentQueue ;
