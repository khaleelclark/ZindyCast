# Climate dashboard v2 integration

Authorized full implementation, 2026-09-13. Existing v1 job/API/CSV remains available under earlier comparison tool. V2 nine-field modeled ERA5, local calendar days, period up to366days or2–5full-year pooled monthly summaries. Provider field validation retained in comparison-expanded-provider; calculations in comparison-statistics.md.

Worker measured worstcase344.3MiB RSS; existing deployment host MemoryHigh384MiB/MemoryMax512MiB inspected read-only. No persistent memory/cache/provider configuration changed. Full summaries compacted under1MB; detail fetches bounded1–31localdays underownedjobauthorization. Detail is separately retrieved and labeled accordingly, not claimed immutable original-summary snapshot. Closingendpoint retained for precipitation/sunshine; temperature chartfilters halfopeninstantday.

API tests integrate in-memory repositories, queued→workercompleted→authorized cached detail, v1/v2 isolation, invalid ranges/city, CSV values/escaping. No live calls for integration. Background workers must be restarted withAPI after final verification; frontendrootbuild publishes. Final acceptance pending browser outcome and final join.

Released after final combined typecheck, 69passing tests/1optional memory skip (separate maximum memory audit passed), and integrated fixtureChrome390/1440 create/cancel/recovery/detail/CSV checks, zeroexternal calls/errors. /tmp/climate-full-{typecheck,build,tests}.log and /tmp/climate-final-browser.log. Production npm run build passed; localAPI+worker restarted andboth active. Health endpoint verified. Physical-device acceptance not claimed. Existingprovider/cache/memory configuration unchanged.
