# Current display and refresh release

September12: gauge, separate current modeled hero and explicit refresh published. Current object used coherently for air/apparent/RH/wind/code/day if forecast fresh and current valid age0..<30min; otherwise hourly fallback visibly labeled. Closer-look measurements, hourly rain probability and WBGT remain hourly. Gauge range remains today's hourly feels-like range; current outside range is not clamped to a fabricated position.

Initial page/effect fetch and Refresh weather send refresh=1. API uses existing persistent cache key with maximum accepted age10sec for that request, retaining ordinary5min storage TTL; sameflight/quotas unchanged. Failures return permitted retained data as stale. New cache version isolates current-enabled payload;28variables charged3weighted accesses. Auto updates remain5min. New provider model output cannot be forced.

35 focused provider/API/cache/current/gauge tests passed; typecheck and root build passed. ActualChrome390/1440 fixture check verified current5C versus hourly0C, F/C rendering, validtime, old-current fallback, initial+button refresh flag and nooverflow/errors. Screenshot inspected. Browser script uses retained fixtures and isolated /tmp/zindycast-current-final-dist; all outside requests intercepted. Logs /tmp/current-final-{tests,typecheck,browser,build}.log and /tmp/current-release-build.log.

API restart successful. One local deployed refresh GET returned200 fresh at20:13:52Z, current20:00Z interval900, air27.6C/apparent32.2C, matching source units/shape. At most one upstream request weighted3; no retries. No claim of station observation, smooth physical cooling, guaranteed provider freshness per refresh, or physical-device acceptance.
