<!--
BUILD-DIGEST TEMPLATE  (the "Narrate" block)
Same muscle as your news digest — but pointed at YOUR build instead of the news.
Copy this into portfolio/src/content/digest/YYYY-MM-DD.md (or append a [BUILD] section to that day's digest),
then run: cd ../portfolio && ./publish.sh
Keep the "How I'd explain this to a customer" line — that's the architect skill the interview tests.
-->

---
title: "Build Log — MONTH DD, 2026"
description: "One-line summary of what you shipped and the decision you made."
date: "YYYY-MM-DD"
type: "daily"
week: NN
---

### [BUILD] <Today's target in plain English>

**System:** se-intel · **Cycle/Week:** 1 / 1 · **Files touched:** `src/...`

**What I built today:**
[2-4 sentences. What works now that didn't this morning.]

**The decision / tradeoff:**
[The architectural choice you made and *why*. e.g. "Chose to filter Vectorize by orgId metadata rather than separate indexes per org — simpler ops, but a noisy-neighbor query-cost risk I'm accepting until 10+ tenants."]

**How I'd explain this to a customer/exec:**
[One jargon-free paragraph. Practice it out loud.]

**What's next / open question:**
[The next unchecked box, or a risk you flagged.]
