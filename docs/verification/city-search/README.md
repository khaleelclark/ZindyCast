# City search latency audit

Actual Chrome phone-width browser, local served app, 2026-09-13. Other weather/map origins blocked; three local search GETs (Boston, Deltona, Boston), at most two upstream cold queries. Boston visible 1066ms (313ms input delay, response1053ms); Deltona492ms; repeatBoston320ms with APIresponse4ms. No multi-second provider stall reproduced; operator device/network/full loaded dashboard cost not reproduced.

Fix: bounded30-entry page-session exact normalized query cache,24h TTL matching server; cachedresults bypassdebounce/network; newqueries200ms debounce instead300. Abort/versionchecks preserved; errorsnotcached.

Fixture-only browser after: Boston299ms,Deltona295ms; repeatBoston12ms and0GET. Rapid Bo→Tokyo displayedTokyo. Build/typecheckpass. No claim coldprovider latency eliminated. Scripts/results retained; scripts use local4311 and /tmp paths.
