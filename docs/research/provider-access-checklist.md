# R3 — bounded authenticated verification plan

Prepared September 10, 2026 by Boston. Planning only: no accounts, credentials, subscriptions, or authenticated requests have been created. This makes the remaining access checks concrete; it does not authorize setup or application development.

## Preconditions

Use an operator-controlled free account and an authorized secure local configuration mechanism before any authenticated request. Keep keys out of chat, source control, screenshots, saved request URLs and logs. Record sanitized endpoints and response metadata. No payment method, paid subscription, or pay-as-you-call activation belongs to this plan. If access requires one, defer that layer.

The [OpenWeather pricing matrix](https://openweathermap.org/full-price), rechecked September 10, advertises permanent free access separately from paid offerings. Exact Maps 1.0 evidence and candidate tile paths are in the [provider audit](providers-maps.md). Public documentation establishes advertised access, not the user's entitlement. The FAQ text fetch returned a site shell, so it did not independently establish key-activation timing.

The [AirNow FAQ](https://docs.airnowapi.org/faq), rechecked September 10, says its query tools insert the user's key into example URLs. Do not copy those examples into research artifacts without removing credentials. Limits are specific to each service, and exhausting an hourly limit can stop data until the next hour. Read the replacement service documentation after authorized access; do not hard-code a remembered quota.

## OpenWeather acceptance sequence

1. Record the free account's Maps 1.0 entitlement and absence of billable services without recording account identifiers or secrets.
2. Confirm the current documented tile path, units and legend for temperature and wind. Begin with one low-zoom tile per layer for CONUS, Alaska and Hawaii: six successful samples maximum, plus one retry per transient failure. Select valid tile coordinates after reading current documentation.
3. Inspect every returned image; record HTTP status, MIME type, dimensions, cache headers, retrieval time, any source-time metadata and attribution. HTTP 200 alone is insufficient.
4. Do not infer observation time from retrieval time or advertised refresh cadence. If source time is unavailable, record it as unknown. Do not promise animation or forecast frames.
5. Record access failures and documented rate-limit handling without intentionally exhausting quota. Verify application secret isolation, caching and browser behavior only after DEVELOP.

## AirNow acceptance sequence

1. Read the replacement observation endpoint documentation, its quota, parameter/schema definitions and current data-use requirements. Resolve the already documented agency/EPA notification requirement before release; no external message has been authorized.
2. Retrieve at most four small current responses: one CONUS reporting area, Anchorage, Honolulu, and one documented unsupported/empty-query case if the service supports it. Do not scan ZIP codes or deliberately consume a quota to test limiting.
3. Preserve reporting-area identity, pollutant, agency, source observation time/time zone, AQI/category, retrieval time and data-use notices. Distinguish observation from forecast and modeled coverage.
4. Inspect response/error content type, including documented XML errors. Empty data means unavailable data/coverage, not clean air. A malformed or unauthorized response is a provider error, not an empty observation.
5. Record quota and cache policy from the selected replacement endpoint; browser integration and runtime failure tests remain implementation work.

## Exit record

For each provider, retain sanitized evidence and one of: verified bounded free access; account unavailable; entitlement unverified; documentation blocked; sample failed. List remaining geographic/time coverage limitations. Successful samples do not close browser/device acceptance or establish continuous availability. Core weather research can proceed while these layers remain blocked.
