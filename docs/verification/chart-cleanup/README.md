# Chart and heat cleanup — September 11, 2026

User requested removing persistent chart value boxes now native MUI tooltips work, removing the green-risk-free sentence and lower upcoming estimate, and moving Heat precautions above the heat graph. Implemented all four. Exact current bands, native tooltips, numerical methods and other source guidance retained. The readout is now screen-reader-only and does not occupy visual space; keyboard value accessibility remains.

Typecheck, nine focused tests and isolated production build passed. Actual fixture Chrome hourly/heat browser scripts pass hover/tap/keyboard, units/missing/DST, no visual readout box, reordered guidance and no overflow/page errors. No live provider calls. Build /tmp/zindycast-clean-charts-dist; existing MapLibre warning. Radar flashing is under a separate bounded investigation; these tests do not diagnose it. Combined served release pending that handoff.

Combined release published following confirmed radar resize-loop fix. Typecheck/build passed; 80 web tests passed, 2 opt-in skips. Opt-in map browser suites passed14/14, and actual Today hover/clock stability audit plus both hourly/heat interaction browser scripts passed against served assets. Zero live provider calls; mobile/desktop fixtures only. No layout proposal changes included.
