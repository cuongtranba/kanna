---
target: c3-233
scope: insert
base: c3-233#n10771@v1:sha256:17756514f56bd1dbcb17c1c0c485dea9d9c652c5342e24a147094d5751613405
---
| adr-20260816-cron-seconds | adr | Sub-minute schedules and the coalescing of consecutive skips into one counted record | decision record | seconds come from node-cron's own 6-field form; the count is tallied at the tick, never derived at read time |
