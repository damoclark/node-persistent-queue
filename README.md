# node-persistent-queue

[![NPM](https://nodei.co/npm/node-persistent-queue.png?downloads=true&downloadRank=true&stars=true)](https://nodei.co/npm/node-persistent-queue/)


## Overview

Simple SQLite backed Queue for running many short tasks in Node.js using `setImmediate()`

If you have a large batch of small running tasks, this library will allow them to execute 
in sequence via the main event thread of node.js without blocking/starving other
node.js events.

## Description

The purpose of this library is to provide a simple means of:
* executing, serially in FIFO order a queue of tasks one at a time
* maintaining an on-disk queue (using SQLite) that persists through crashes/restarts
* ensuring the node.js event loop can return to the 
[poll phase](https://nodejs.org/en/docs/guides/event-loop-timers-and-nexttick/)
between invocations of each job using setImmediate(), thus preventing blocking.
* asynchronicity via Promises

A unit of work, or *task* is stored in the queue as a simple json object.  Each task
should complete with sufficient speed so as not to block your node.js event loop. 

If you cannot break your tasks down sufficiently, you should consider a multi-threaded
`Worker` implementation instead.

If however, you have a large batch of small running tasks, this library will allow 
them to execute via the main event thread of node.js without blocking/starving other
node.js events.

Refer to the [Event Loop Timers and Nexttick Guide](https://nodejs.org/en/docs/guides/event-loop-timers-and-nexttick/) 
from [https://nodejs.org](https://nodejs.org) for a great explanation of the node.js
events thread.

## Installation

```bash
$ npm install --save node-persistent-queue
```

## Usage

The module is quite simple to use through its 
[EventEmitter API](https://nodejs.org/api/events.html#events_class_eventemitter).

### Instantiation

The following illustrates how to specify the location of the SQLite database for your instance.

```javascript
var Queue = require('node-persistent-queue') ;

/*
Provide path to your sqlite database.  If file doesn't exist, it will be created
 */
var q = new Queue('./path/to/db.sqlite') ;

/*
You can use an in-memory sqlite database (although it would no longer be a persistent queue)
 */
var q = new Queue(':memory:') ;
// or
var q = new Queue('') ;
```

The second optional parameter specifies the number of *tasks* to retrieve from the DB at a time.

```javascript
/*
By default, the module will retrieve up to 10 'tasks' from the sqlite database at a time. 
If the data for your tasks is quite large, you can reduce this to conserve more memory
or you can increase this limit to improve throughput.
 */
var q = new Queue('./path/to/db.sqlite',1) ; // Retrieve each job from DB one at a time

var q = new Queue('./path/to/db.sqlite',1000) ; // Grab 1000 at a time
```

### Events

`node-persistent-queue` emits events according to the following table:

| Event | Description                                                                                                                                                                                     | Event Handler Parameters                                                                                                        |
|:-----:|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------|
| start | Emitted when the queue starts processing tasks (after calling .start() method)                                                                                                                  | q.on('start',function(){<br/> }) ;                                                                                              |
|  stop | Emitted when the queue stops processing tasks (after calling .stop() method)                                                                                                                    | q.on('stop',function(){<br/>}) ;                                                                                                |
|  next | Emitted when the next task is to be executed.  This occurs:<br/> * when there are items in the queue and .start() has been called; or<br/> * after .add() has been called to add a task to an empty queue and queue `isStarted()` already | q.on('next',function(job) {<br/>&nbsp;&nbsp;job.id,<br/>&nbsp;&nbsp;job.job <br/>}) ; |
| empty | Emitted when the last task is completed and removed from the db                                                                                                                                 | q.on('empty',function() {<br/> }) ;                                                                                             |
|   add | Emitted when a task has been added to the queue (after calling .add() method)                                                                                                                   | q.on('add',function(job) {<br/>&nbsp;&nbsp;job.id,<br/>&nbsp;&nbsp;job.job <br/>}) ;                                            |
|  open | Emitted when the sqlite database has been opened successfully (after calling .open() method)                                                                                                    | q.on('open',function(sqlite) {<br/>&nbsp;&nbsp;sqlite //instance of sqlite3.Database <br/>}) ;                                  |
| close | Emitted when the sqlite database has been closed successfully (after calling .close() method)                                                                                                   | q.on('close',function() {<br/> }) ;                                                                                             |

### Contrived Example

This example illustrates the use of the events emitted from node-persistent-queue.  

The `empty` event handler below automatically stops the queue when it becomes empty.  It then closes
the SQLite DB and terminates the script.

Note, that the `next` event handler, on completion of processing the task, must call the `.done()` 
callback method.  This will then schedule another `next` event to be emitted, using `setImmediate()`.  

The `.add()` method allow call chaining as illustrated below.

```javascript
var Queue = require('node-persistent-queue') ;
var q = new Queue(':memory:') ;

var task1 = {
	data: "Data1"
} ;
var task2 = {
	data: "Data2"
} ;
var task3 = {
	data: "Data3"
} ;
var task4 = {
	data: "Data4"
} ;

q.on('open',function() {
	console.log('Opening SQLite DB') ;
	console.log('Queue contains '+q.getLength()+' job/s') ;
}) ;

q.on('add',function(task) {
	console.log('Adding task: '+JSON.stringify(task)) ;
	console.log('Queue contains '+q.getLength()+' job/s') ;
}) ;

q.on('start',function() {
	console.log('Starting queue') ;
}) ;

q.on('next',function(task) {
	console.log('Queue contains '+q.getLength()+' job/s') ;
	console.log('Process task: ') ;
	console.log(JSON.stringify(task)) ;

	// Must tell Queue that we have finished this task
	// This call will schedule the next task (if there is one)
	q.done() ;
}) ;

// Stop the queue when it gets empty
q.on('empty',function() {
	console.log('Queue contains '+q.getLength()+' job/') ;
	q.stop() ;
	q.close()
	.then(function() {
		process.exit(0) ;
	})
}) ;

q.on('stop',function() {
	console.log('Stopping queue') ;
}) ;

q.on('close',function() {
	console.log('Closing SQLite DB') ;
}) ;

q.open()
.then(function() {
	q.add(task1)
		.add(task2)
		.add(task3)
		.add(task4)
	.start() ;
})
.catch(function(err) {
	console.log('Error occurred:') ;
	console.log(err) ;
	process.exit(1) ;
}) ;

```

The above script produces the following output:

```
Opening SQLite DB
Queue contains 0 job/s
Starting queue
Adding task: {"id":1,"job":{"data":"Data1"}}
Queue contains 1 job/s
Adding task: {"id":2,"job":{"data":"Data2"}}
Queue contains 2 job/s
Adding task: {"id":3,"job":{"data":"Data3"}}
Queue contains 3 job/s
Adding task: {"id":4,"job":{"data":"Data4"}}
Queue contains 4 job/s
Queue contains 4 job/s
Process task: 
{"id":1,"job":{"data":"Data1"}}
Queue contains 3 job/s
Process task: 
{"id":2,"job":{"data":"Data2"}}
Queue contains 2 job/s
Process task: 
{"id":3,"job":{"data":"Data3"}}
Queue contains 1 job/s
Process task: 
{"id":4,"job":{"data":"Data4"}}
Queue contains 0 job/
Stopping queue
Closing SQLite DB
```

### Notes

You may be wondering why the `start` event is emitted before the `add` events, based on the
output above.  

The `.add()` method calls perform an asynchronous write to the SQLite database.
The callback that emits the `add` event from this I/O doesn't happen until after the 
current block of code completes.  Thus, the `.start()` method is called first along with 
the `start` event.  

Whether the *tasks* are added before starting the queue or after doesn't matter because
the `next` event cannot occur until both the `add` and `start` events have fired.

The queue can be left in the `start` state (when the queue becomes empty, you don't have
to `.stop()` it).  As things are `.add()`ed, the `next` event will be emitted after the
current code block finishes.

## TODO

A [TODO List](TODO.md) of possible future features is included.  Contributions
welcome.


## Licence

Copyright (c) 2017 Damien Clark, [Damo's World](https://damos.world)<br/> <br/>
Licenced under the terms of the
[GPLv3](https://www.gnu.org/licenses/gpl.txt)<br/>
![GPLv3](https://www.gnu.org/graphics/gplv3-127x51.png "GPLv3")

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL DAMIEN CLARK BE LIABLE FOR ANY DIRECT,
INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING,
BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE
OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF
ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.


## Acknowledgements / Attribution

Thanks to the [SQLite team](https://www.sqlite.org/about.html) for an awesome 
*"in-process library that implements a self-contained, serverless, zero-configuration, 
transactional SQL database engine."*
