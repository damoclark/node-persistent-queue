/**
 * test.js
 *
 * Mocha Test Script
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



var debug = false ;

var should = require('should') ;
var sinon = require('sinon') ;
var os = require('os') ;
var fs = require('fs') ;
var path = require('path') ;

require('should-sinon') ;

var Queue = require('../index') ;

describe('Calling Constructor',function() {
	it('should use :memory: if file is empty string',function(done) {
		var q = new Queue('') ;
		q.open().should.be.fulfilled() ;
		done() ;
	}) ;

	it('should throw if filename not provided',function(done) {
		(function(){new Queue();}).should.throw(Error) ;
		done() ;
	}) ;

	it('should throw when passed a batchSize less than 1',function() {
		(function (){new Queue(':memory:', -1);}).should.throw(Error);
	}) ;

	it('should throw when passed a batchSize that is not a number',function() {
		(function (){new Queue(':memory:', 'text');}).should.throw(Error);
	}) ;
}) ;

describe('Unopened SQLite DB',function() {
	var q = new Queue(':memory:', 2);

	it('should throw on calling start() before open is called', function () {
		(function () {
			q.start();
		}).should.throw(Error);
	});

	it('should throw on calling isEmpty() before open is called', function () {
		(function () {
			q.isEmpty();
		}).should.throw(Error);
	});

	it('should throw on calling getSqlite3() before open is called', function () {
		(function () {
			q.getSqlite3();
		}).should.throw(Error);
	});
}) ;

describe('Open Errors', function () {
	it('should reject Promise on no write permissions to db filename', function (done) {
		var q = new Queue('/cantwritetome', 2);
		q.open().should.be.rejected();
		done();
	});

	it('should reject Promise when db filename is not a string', function (done) {
		var q = new Queue(true, 2);
		q.open().should.be.rejected();
		done();
	});
});

describe('Maintaining queue length count', function() {
	it('should count existing jobs in db on open',function (done) {
		var q = new Queue('./test/db2.sqlite') ;
		q.open()
		.then(function() {
			q.getLength().should.equal(1) ;
			return q.close() ;
		})
		.then(function() {
			done() ;
		})
		.catch(function(err) {
			done(err) ;
		}) ;
	}) ;

	it('should count jobs as added and completed',function(done) {
		var tmpdb = os.tmpdir() + path.sep + process.pid + '.sqlite' ;
		var q = new Queue(tmpdb) ;

		/**
		 * Count jobs
		 * @type {integer}
		 */
		var c = 0 ;

		q.on('add',function() {
			q.getLength().should.equal(++c) ;
		}) ;

		q.open()
		.then(function() {
			q.add('1')
			.add('2')
			.add('3') ;

			return q.close() ;
		})
		.then(function() {
			q = new Queue(tmpdb) ;

			return q.open() ;
		})
		.then(function() {
			q.getLength().should.equal(3) ;

			q.on('next',function() {
				q.getLength().should.equal(c--) ;
				q.done() ;
			}) ;

			q.on('empty',function() {
				q.getLength().should.equal(0) ;
				q.close()
				.then(function() {
					fs.unlinkSync(tmpdb) ;
					done() ;
				}) ;
			}) ;

			q.start() ;
		})
		.catch(function(err) {
			done(err) ;
		}) ;
	}) ;
}) ;

describe('Close Errors',function() {
	var q = new Queue(':memory:') ;

	before(function(done) {
		q.open()
		.then(function() {
			done();
		}) ;
	}) ;

	it('should close properly',function(done) {
		q.add('1') ;

		q.close().should.be.fulfilled() ;
		done() ;
	}) ;
}) ;


describe('Invalid JSON', function () {
	it('should throw on bad json stored in db', function (done) {
		var q = new Queue('./test/db.sqlite', 1);
		q.open()
		.should.be.rejectedWith(SyntaxError);
		done();
	});
});

describe('Emitters',function() {
	var q ;

	beforeEach(function (done) {
		q = new Queue(':memory:') ;
		q.open()
		.then(function () {
			done();
		})
		.catch(function(err) {
			done(err) ;
		}) ;
	});

	afterEach(function(done) {
		q.close()
		.then(function(){
			done() ;
		})
		.catch(function(err) {
			done(err) ;
		}) ;
	}) ;

	it('should emit add', function (done) {
		q.on('add', function (job) {
			job.job.should.equal('1');
			done();
		});

		q.add('1');
	});

	it('should emit start',function(done) {
		var s = sinon.spy() ;

		q.on('start',s) ;

		q.start() ;

		s.should.be.calledOnce() ;
		q.isStarted().should.be.equal(true) ;
		done() ;
	}) ;

	it('should emit next when adding after start',function(done) {
		q.on('next',function(job) {
			job.job.should.equal('1') ;
			// TODO: q.done() ;
			q.done() ;
			done() ;
		}) ;

		q.start() ;
		q.add('1') ;
	}) ;

	it('should emit next when adding before start',function(done) {
		q.on('next',function(job) {
			job.job.should.equal('1') ;
			q.done() ;
			done() ;
		}) ;

		q.add('1') ;
		q.start() ;
	}) ;

	it('should emit empty',function(done) {
		var empty = 0 ;
		q.on('empty',function(){
			// empty should only emit once
			(++empty).should.be.equal(1) ;
			q.getLength().should.equal(0) ;
			done() ;
		}) ;

		q.on('next',function(job) {
			if(debug) console.log(job) ;
			q.done() ;
		}) ;
		q.add('1') ;
		q.add('2') ;
		q.start() ;
	}) ;

	it('3 adds before start should emit 3 nexts',function(done) {
		var next = 0 ;
		q.on('empty',function(){
			next.should.be.equal(3) ;
			q.getLength().should.equal(0) ;
			done() ;
		}) ;

		q.on('next',function(job) {
			if(debug) console.log(job) ;
			++next ;
			q.done() ;
		}) ;
		q.add('1') ;
		q.add('2') ;
		q.add('3') ;
		q.start() ;
	}) ;

	it('should add 3 jobs and after start should emit 3 nexts',function(done) {
		var next = 0 ;
		q.on('empty',function(){
			next.should.be.equal(3) ;
			q.getLength().should.equal(0) ;
			done() ;
		}) ;

		q.on('next',function(job) {
			if(debug) console.log(job) ;
			++next ;
			q.done() ;
		}) ;
		q.start() ;
		q.add('1') ;
		q.add('2') ;
		q.add('3') ;
	}) ;

	it('should start in middle of 3 adds and should emit 3 nexts',function(done) {
		var next = 0 ;
		q.on('empty',function(){
			next.should.be.equal(3) ;
			q.getLength().should.equal(0) ;
			done() ;
		}) ;

		q.on('next',function(job) {
			if(debug) console.log(job) ;
			++next ;
			q.done() ;
		}) ;
		q.add('1') ;
		q.add('2') ;
		q.start() ;
		q.add('3') ;
	}) ;

		it('should emit stop',function(done) {
			var stop = 0 ;
			q.on('stop',function(){
				(++stop).should.be.equal(1) ;
				q.isStarted().should.be.equal(false) ;
				done() ;
			}) ;

			q.on('empty',function(){
				q.stop() ;
			}) ;

			q.on('next',function(job) {
				if(debug) console.log(job) ;
				q.done() ;
			}) ;
			q.add('1') ;
			q.add('2') ;
			q.start() ;
			q.add('3') ;
			q.add('4') ;
		}) ;

		it('should emit open',function(done) {
			var q1 = new Queue(':memory:') ;
			var open = 0;
			q1.on('open', function () {
				(++open).should.be.equal(1) ;
				q1.isOpen().should.be.equal(true) ;
				q1.close()
				.then(function () {
					done() ;
				}) ;
			}) ;
			q1.open() ;
		}) ;

		it('should emit close',function(done) {
			var q1 = new Queue(':memory:') ;
			var close = 0;
			q1.on('close', function () {
				(++close).should.be.equal(1);
				q1.isOpen().should.be.equal(false) ;
			}) ;
			q1.open()
			.then(function() {
				return q1.close() ;
			})
			.then(function() {
				done() ;
			})
		}) ;
}) ;
