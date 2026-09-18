# Radar card overflow fix — September 11, 2026

The supplied screenshot showed radar playback, legend and metadata overlapping the following measurements card. Desktop CSS positioned the entire radar card absolutely inside a grid item. Its controls therefore could not contribute to row sizing; the recent control additions exceeded the row height.

Removed absolute positioning from the compact radar card. It remains a flexible column with an expanding map viewport, while its controls, warnings and expanded details now contribute to normal grid sizing. No content is clipped or hidden to suppress the defect.

Typecheck and production build passed. Focused maps tests: eight passed, one optional fixture browser test skipped. Actual Chrome layout regression in tests/browser/map-layout.mjs passed at 1280, 800 and 390 pixels, with technical details both closed and open. All map content remains inside its card; the following measurement card starts below it; no document horizontal overflow or page exceptions. The initial Honolulu radar was live; further viewport frame requests deliberately returned local test errors to exercise warning containment without additional provider demand. Screenshot 1280.png visually inspected. Updated served assets; no backend changes or service restart needed.
