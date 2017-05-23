# TODO

## Provide more meaningful examples

The current example on the README.md is contrived.  A more authentic example from real code
should be added to better explain the purpose/function of the module and its characteristics.  

## Be able to remove all user event handlers on the queue instance  

Perhaps @override the `.removeAllListeners()` method so that only user handlers are removed
and not those used by the module itself

## Keep running count of the jobs in the persistent queue

We can use triggers to update a table with the number in persistent storage

The class can retrieve this when opening the database, and maintain an in-memory
count, meanwhile the triggers will maintain the on-disk count

This should provide the optimum performance for looking up the queue size

### Insert trigger
```sqlite
CREATE TRIGGER IF NOT EXISTS queue_insert
AFTER INSERT
ON queue
BEGIN
update queue_count set counter = counter + 1 ;
END;
```

### Delete trigger
```sqlite
CREATE TRIGGER IF NOT EXISTS queue_delete
AFTER DELETE
ON queue
BEGIN
update queue_count set counter = counter - 1 ;
END;
```

### Count table
```sqlite
CREATE TABLE IF NOT EXISTS queue_count (counter BIGINT) ;
INSERT INTO queue_count SELECT 0 as counter WHERE NOT EXISTS(SELECT * FROM queue_count) ;
```
