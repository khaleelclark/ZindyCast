# Dynamic resize repair — September 16, 2026

User screenshot at roughly 1328px showed the wind compass colliding with the detail heading and cramped nested columns. Actual Chrome fixture reproduction confirmed wind top376px versus heading bottom413px at1328px; the overlap recurred at768px and1600px despite no document overflow. Checking only page width had missed this internal collision.

Changes limited to styles.css and connected-grid.css:
- Remove obsolete negative wind margins/floats at their definitions.
- Hero uses a named inline-size container; inner details become two columns only when the actual panel has640px available. All smaller panels keep a single reading flow.
- Give the primary current panel a1.5:1 desktop share; map remains secondary.
- Remove negative-offset collapsed detail positioning; details use normal flow, including after opening/closing or resizing.
- Wrap header actions and current metadata; use intrinsic grid sizing for metric summaries.
- Six next-hour tiles wrap to available space; daily planning text stacks below440px of its own container width.

Verification: typecheck passed; general web suite126 passed/4 optional skipped. Isolated blank-token build passed. Actual Chrome fixture test at18 successive widths from320 through1600, including reverse resizing and60 rapid size changes: no page overflow, compass below heading, all tiles contained, hourly SVG width fits, same radar canvas with matching resized container width. Maps/History/Compare/Settings additionally resized in the same session at8 widths each. Zero page errors. Screenshot1328 and390 visually inspected. Retained/synthetic fixtures only; all provider, basemap and quota requests intercepted, no live calls. Physical Safari/iOS and screen-reader acceptance not claimed.

Scripts/logs are retained here; after-script expects isolated /tmp/zindycast-resize-dist and installed system Chrome. Source fixture paths are inside repository verification evidence. Existing specialized table horizontal scrolling is preserved. No React/data/provider/map lifecycle changes or extra ResizeObserver were needed.

Existing map regression initially passed15/16; the forecast browser audit reached its regional-switch step then timed out looking for a saved city. It assumed saved-city buttons were always visible, while the current app places them in the location chooser. Updated only that test step to open “Change location” before selecting each city; application behavior was not changed to satisfy the test. Initial failure log retained.

Corrected forecast regression rerun7/7 passed (including actual Chrome); observed suite9/9 had passed in the combined run. Root production build/compression passed; API health returned ok. Frontend assets published without service restart. No production provider requests were needed.
