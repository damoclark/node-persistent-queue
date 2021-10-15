/**
 * test.js
 *
 * Mocha Test Script
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


/* eslint no-undef: 0 */

const debug = false ;

// eslint-disable-next-line no-unused-vars
const should = require('should') ;
const sinon = require('sinon') ;
const os = require('os') ;
const fs = require('fs') ;
const path = require('path') ;

require('should-sinon') ;

const Queue = require('../index') ;

describe('Calling Constructor', () => {
	it('should use :memory: if file is empty string', done => {
		let q = new Queue('') ;
		q.open().should.be.fulfilled() ;
		done() ;
	}) ;

	it('should throw if filename not provided', done => {
		(() =>{
			new Queue() ;
		}).should.throw(Error) ;
		done() ;
	}) ;

	it('should throw when passed a batchSize less than 1', () => {
		(() => {
			new Queue(':memory:', -1) ;
		}).should.throw(Error) ;
	}) ;

	it('should throw when passed a batchSize that is not a number', () => {
		(() => {
			new Queue(':memory:', 'text') ;
		}).should.throw(Error) ;
	}) ;
}) ;

describe('Correct queue fifo order', () => {
	let q ;
	before(done => {
		// Remove previous db3.sqlite (if exists) before creating db anew
		fs.unlink('./test/db3.sqlite', () => {
			q = new Queue('./test/db3.sqlite') ;
			done() ;
		}) ;
	}) ;

	it('should execute jobs in fifo order', done => {
		let sequence = 0 ;
		q.on('next', task => {
			task.job.sequence.should.equal(sequence++) ;
			q.done() ;
		}) ;

		q.on('empty', () => {
			q.close() ;
			done() ;
		}) ;

		q.open()
		.then(() => {
			q.start() ;

			for(let i = 0 ; i < 100 ; ++i) {
				let task = {sequence: i} ;
				q.add(task) ;
			}
		}) ;
	}) ;
}) ;

describe('Search remaining jobs', () => {
	let q ;
	beforeEach(done => {
		q = new Queue(':memory:', 10) ;
		q.open()
		.then(() => done())
		.catch(err => done(err)) ;
	}) ;

	it('should find first job in the queue', done => {
		q.open()
		.then(() => {

			let promises = [] ;
			for(let i = 1 ; i <= 1000 ; ++i) {
				let task = {sequence: i % 501} ;
				promises.push(q.add(task)) ;
			}

			// Wait for all tasks to be added before calling hasJob method to search for it
			Promise.all(promises)
			.then(() => {
				for(let i = 1 ; i <= 500 ; ++i)
					q.getFirstJobId({sequence: i}).should.be.fulfilledWith(i) ;
				
				q.close().then(() => done()) ;
			})
			.catch(err => console.log(err)) ;
		}) ;
	}) ;

	it('should find first job in the in-memory queue', done => {
		q.open()
		.then(() => {

			let promises = [] ;
			promises.push(q.add({})) ;
			for(let i = 1 ; i <= 1000 ; ++i) {
				let task = {sequence: i % 501} ;
				promises.push(q.add(task)) ;
			}

			// Grab first job and throw away so in-memory queue is hydrated
			q.on('next', () => {
				q.stop() ;
				q.done() ;
				// Now let's check if all items are
				for(let i = 1 ; i <= 500 ; ++i)
					q.getFirstJobId({sequence: i}).should.be.fulfilledWith(i+1) ;
				
				q.close().then(() => done()) ;
			}) ;

			// Wait for all tasks to be added before calling hasJob method to search for it
			Promise.all(promises)
			.then(() =>{
				q.start() ;
			})
			.catch(err =>{
				console.log(err) ;
			}) ;

		}) ;
	}) ;

	it('should find all matching jobs in the queue and in order', done => {
		q.open()
		.then(() => {

			let promises = [] ;
			for(let i = 1 ; i <= 10 ; ++i) {
				let task = {sequence: i % 5} ;
				promises.push(q.add(task)) ;
			}

			// Wait for all tasks to be added before calling hasJob method to search for it
			Promise.all(promises)
			.then(() =>{
				for(let i = 1 ; i <= 5 ; ++i)
					q.getJobIds({sequence: i % 5}).should.be.fulfilledWith([i, i + 5]) ;
				
				q.close().then(() =>{
					done() ;
				}) ;
			}) ;

		}) ;
	}) ;

	it('should return empty array if job not in queue', done => {
		q.open()
		.then(() => {

			let promises = [] ;
			for(let i = 1 ; i <= 10 ; ++i) {
				let task = {sequence: i} ;
				promises.push(q.add(task)) ;
			}

			// Wait for all tasks to be added before calling hasJob method to search for it
			Promise.all(promises)
			.then(() =>{
				for(let i = 1 ; i <= 5 ; ++i)
					q.getJobIds({sequence: 100}).should.be.fulfilledWith([]) ;
				
				q.close().then(() =>{
					done() ;
				}) ;
			}) ;

		}) ;
	}) ;

	it('should return null if job not in queue', done => {
		q.open()
		.then(() => {

			let promises = [] ;
			for(let i = 1 ; i <= 10 ; ++i) {
				let task = {sequence: i} ;
				promises.push(q.add(task)) ;
			}

			// Wait for all tasks to be added before calling hasJob method to search for it
			Promise.all(promises)
			.then(() =>{
				for(let i = 1 ; i <= 5 ; ++i)
					q.getFirstJobId({sequence: 100}).should.be.fulfilledWith(null) ;
				
				q.close().then(() =>{
					done() ;
				}) ;
			}) ;

		}) ;
	}) ;

}) ;

describe('Unopened SQLite DB', () => {
	let q = new Queue(':memory:', 2) ;

	it('should throw on calling start() before open is called', () => {
		(() => {
			q.start() ;
		}).should.throw(Error) ;
	}) ;

	it('should throw on calling isEmpty() before open is called', () => {
		(() => {
			q.isEmpty() ;
		}).should.throw(Error) ;
	}) ;

	it('should throw on calling getSqlite3() before open is called', () => {
		(() => {
			q.getSqlite3() ;
		}).should.throw(Error) ;
	}) ;
}) ;

describe('Open Errors', () => {
	it('should reject Promise on no write permissions to db filename', done => {
		let q = new Queue('/cantwritetome', 2) ;
		q.open().should.be.rejected() ;
		done() ;
	}) ;

	it('should reject Promise when db filename is not a string', done => {
		let q = new Queue(true, 2) ;
		q.open().should.be.rejected() ;
		done() ;
	}) ;
}) ;

describe('Maintaining queue length count', () => {
	it('should count existing jobs in db on open', done => {
		let q = new Queue('./test/db2.sqlite') ;
		q.open()
		.then(() => {
			q.getLength().should.equal(1) ;
			return q.close() ;
		})
		.then(() => {
			done() ;
		})
		.catch(err => {
			done(err) ;
		}) ;
	}) ;

	it('should count jobs as added and completed', done => {
		let tmpdb = os.tmpdir() + path.sep + process.pid + '.sqlite' ;
		let q = new Queue(tmpdb) ;

		/**
		 * Count jobs
		 * @type {number}
		 */
		let c = 0 ;

		q.on('add', () => {
			q.getLength().should.equal(++c) ;
		}) ;

		q.open()
		.then(() => {
			q.add('1') ;
			q.add('2') ;
			q.add('3') ;

			return q.close() ;
		})
		.then(() => {
			q = new Queue(tmpdb) ;

			return q.open() ;
		})
		.then(() => {
			q.getLength().should.equal(3) ;

			q.on('next', () => {
				q.getLength().should.equal(c--) ;
				q.done() ;
			}) ;

			q.on('empty', () => {
				q.getLength().should.equal(0) ;
				q.close()
				.then(() => {
					fs.unlinkSync(tmpdb) ;
					done() ;
				}) ;
			}) ;

			q.start() ;
		})
		.catch(err => {
			done(err) ;
		}) ;
	}) ;
}) ;

describe('Close Errors', () => {
	let q = new Queue(':memory:') ;

	before(done => {
		q.open()
		.then(() => {
			done() ;
		}) ;
	}) ;

	it('should close properly', done => {
		q.add('1') ;

		q.close().should.be.fulfilled() ;
		done() ;
	}) ;
}) ;


describe('Invalid JSON', () => {
	it('should throw on bad json stored in db', done => {
		let q = new Queue('./test/db.sqlite', 1) ;
		q.open()
		.should.be.rejectedWith(SyntaxError) ;
		done() ;
	}) ;
}) ;

describe('Emitters', () => {
	let q ;

	beforeEach(done => {
		q = new Queue(':memory:') ;
		q.open()
		.then(() => {
			done() ;
		})
		.catch(err => {
			done(err) ;
		}) ;
	}) ;

	afterEach(done => {
		q.close()
		.then(() =>{
			done() ;
		})
		.catch(err => {
			done(err) ;
		}) ;
	}) ;

	it('should emit add', done => {
		q.on('add', job => {
			job.job.should.equal('1') ;
			done() ;
		}) ;

		q.add('1') ;
	}) ;

	it('should emit start', done => {
		let s = sinon.spy() ;

		q.on('start', s) ;

		q.start() ;

		s.should.be.calledOnce() ;
		q.isStarted().should.be.equal(true) ;
		done() ;
	}) ;

	it('should emit next when adding after start', done => {
		q.on('next', job => {
			job.job.should.equal('1') ;
			// TODO: q.done() ;
			q.done() ;
			done() ;
		}) ;

		q.start() ;
		q.add('1') ;
	}) ;

	it('should emit next when adding before start', done => {
		q.on('next', job => {
			job.job.should.equal('1') ;
			q.done() ;
			done() ;
		}) ;

		q.add('1') ;
		q.start() ;
	}) ;

	it('should emit empty', done => {
		let empty = 0 ;
		q.on('empty', () =>{
			// empty should only emit once
			(++empty).should.be.equal(1) ;
			q.getLength().should.equal(0) ;
			done() ;
		}) ;

		q.on('next', job => {
			if(debug) console.log(job) ;
			q.done() ;
		}) ;
		q.add('1') ;
		q.add('2') ;
		q.start() ;
	}) ;

	it('3 adds before start should emit 3 nexts', done => {
		let next = 0 ;
		q.on('empty', () =>{
			next.should.be.equal(3) ;
			q.getLength().should.equal(0) ;
			done() ;
		}) ;

		q.on('next', job => {
			if(debug) console.log(job) ;
			++next ;
			q.done() ;
		}) ;
		q.add('1') ;
		q.add('2') ;
		q.add('3') ;
		q.start() ;
	}) ;

	it('should add 3 jobs and after start should emit 3 nexts', done => {
		let next = 0 ;
		q.on('empty', () =>{
			next.should.be.equal(3) ;
			q.getLength().should.equal(0) ;
			done() ;
		}) ;

		q.on('next', job => {
			if(debug) console.log(job) ;
			++next ;
			q.done() ;
		}) ;
		q.start() ;
		q.add('1') ;
		q.add('2') ;
		q.add('3') ;
	}) ;

	it('should start in middle of 3 adds and should emit 3 nexts', done => {
		let next = 0 ;
		q.on('empty', () =>{
			next.should.be.equal(3) ;
			q.getLength().should.equal(0) ;
			done() ;
		}) ;

		q.on('next', job => {
			if(debug) console.log(job) ;
			++next ;
			q.done() ;
		}) ;
		q.add('1') ;
		q.add('2') ;
		q.start() ;
		q.add('3') ;
	}) ;

	it('should emit stop', done => {
		let stop = 0 ;
		q.on('stop', () =>{
			(++stop).should.be.equal(1) ;
			q.isStarted().should.be.equal(false) ;
			done() ;
		}) ;

		q.on('empty', () =>{
			q.stop() ;
		}) ;

		q.on('next', job => {
			if(debug) console.log(job) ;
			q.done() ;
		}) ;
		q.add('1') ;
		q.add('2') ;
		q.start() ;
		q.add('3') ;
		q.add('4') ;
	}) ;

	it('should emit open', done => {
		let q1 = new Queue(':memory:') ;
		let open = 0 ;
		q1.on('open', () => {
			(++open).should.be.equal(1) ;
			q1.isOpen().should.be.equal(true) ;
			q1.close()
			.then(() => {
				done() ;
			}) ;
		}) ;
		q1.open() ;
	}) ;

	it('should emit close', done => {
		let q1 = new Queue(':memory:') ;
		let close = 0 ;
		q1.on('close', () => {
			(++close).should.be.equal(1) ;
			q1.isOpen().should.be.equal(false) ;
		}) ;
		q1.open()
		.then(() => {
			return q1.close() ;
		})
		.then(() => {
			done() ;
		}) ;
	}) ;
}) ;
