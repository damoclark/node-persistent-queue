# TODO

## Provide more meaningful examples

The current example on the README.md is contrived.  A more authentic example from real code
should be added to better explain the purpose/function of the module and its characteristics.  

## Be able to remove all user event handlers on the queue instance  

Perhaps @override the `.removeAllListeners()` method so that only user handlers are removed
and not those used by the module itself

## Be able to manually remove jobs by id number or remove all jobs from queue

`.deleteAll()` or `.purge()`
