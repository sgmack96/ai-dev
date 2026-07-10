# What Changed — 002-b vs Original RFP

> **Original (StyleLabs):** B2B SaaS, multi-tenant marketing content hub. CDN + WAF + SSL for SaaS + Argo. Single-vendor CDN displacement (Azure Front Door).
> **This (002-b):** Live-streaming/creator platform, Digital Native scale-up. CDN + CNI + Load Balancer + SSL for SaaS. **Upsell/renewal expansion on an existing customer — not a competitive displacement.**

> **Note on sourcing:** this scenario is a fully fictional composite, built to explore a real technical pattern (WebRTC/WHIP ingestion latency + Cloudflare Network Interconnect) rather than sanitized from any specific account. No company, employee, or customer detail below refers to anything real.

---

## New Deal Shape: Upsell, Not Net-New

Every other win wire in this lab (`001-a`, `002-a`, `003-a`) is a **net-new logo** — displacing an incumbent vendor at a customer that wasn't previously on Cloudflare for that product. This one is different on purpose: it's an **existing customer expanding their footprint** on renewal. That's a different sales motion with different leverage:

- **No "what was displaced" story.** There's no competitor to unseat — the competitive question becomes "why expand with the incumbent vs. build this in-house or bring in a point solution," which is a build-vs-buy argument, not a vendor-switch argument.
- **The renewal *is* the vehicle.** Expansion products get bundled into the renewal conversation rather than sold as a standalone deal — timing and structure matter differently (see `WIN-WIRE.md`).
- **Trust is already established.** The technical validation bar is lower (they already trust the platform); the bar that matters is "does this specific new product actually solve my specific new problem," which makes the discovery conversation more technical and less about competitive comparison.

---

## New Vertical: Live-Streaming / Real-Time Video

Real-time video is architecturally distinct from the CDN pillar's usual "cache static/dynamic content" story, because the traffic pattern is fundamentally different: it's **ingestion-heavy and latency-sensitive in both directions**, not just delivery-heavy.

**Two ingestion protocols worth knowing (this is real, public technical knowledge — not specific to any customer):**

| Protocol | What it is | Best fit |
|---|---|---|
| **RTMP** (Real-Time Messaging Protocol) | Legacy streaming ingestion protocol, originally Adobe Flash-era. Still dominant in production because tooling is mature. | Broadcast-style, one-to-many, latency-tolerant (seconds of buffer acceptable) |
| **WHIP** (WebRTC-HTTP Ingestion Protocol) | A modern, HTTP-based signaling flow for WebRTC ingestion — a broadcaster POSTs an SDP offer over plain HTTP, gets an SDP answer back, then WebRTC media flows. | Low-latency, one-way ingestion — the broadcaster side of a live interactive stream |
| **TURN** (Traversal Using Relays around NAT) | A NAT-traversal relay protocol for WebRTC, built for *bidirectional* peer-to-peer use cases like video conferencing. | Two-way real-time communication, not one-way broadcast ingestion |

**Why this distinction matters commercially:** a platform built for one-way, low-latency broadcaster ingestion (WHIP) has a different infrastructure shape than a platform built for two-way conferencing (TURN-based relay). If a customer's use case is broadcast ingestion, a product built around TURN relay isn't a fit even if it's WebRTC-native — the protocol match matters, not just "does it support WebRTC."

---

## New Architecture Pattern: The Hairpin Problem + CNI as the Fix

**The pattern (generic, not customer-specific):** A platform ingests low-latency WebRTC traffic at edge points, but their processing origin is centralized in one region. A broadcaster in a growing market connects to a nearby edge ingestion point, but that traffic then routes all the way to the centralized origin and back — even when the viewer is in the *same region* as the broadcaster. This "hairpin" defeats the entire purpose of choosing a low-latency ingestion protocol in the first place.

**Compounding factor:** if the growing market's regional PoPs are also capacity-constrained during peak hours, traffic gets rerouted to alternate PoPs — adding *more* latency on top of the hairpin, right when demand (and therefore the customer's revenue exposure) is highest.

**Why Cloudflare Network Interconnect (CNI) is the right fix for both problems at once:**
- **Capacity constraint:** CNI is a dedicated physical/BGP interconnect at a facility of the customer's choosing — traffic no longer competes with the shared public PoP capacity pool.
- **Hairpin routing:** because it's a direct, customer-controlled handoff point, the customer gains routing control they don't have on the public network — enabling them to route regional ingestion traffic to stay regional instead of bouncing through a centralized origin.
- **Cost:** as a side effect, CNI typically reduces transit costs, since the customer no longer pays a third-party transit provider to reach Cloudflare's public network.

**How to pick the CNI location in a discovery conversation:** ask for a traffic breakdown by facility/region. Whichever facility already carries the plurality of the customer's Cloudflare-bound traffic is almost always the right CNI location — it's the path of least resistance and the fastest to deploy, since the customer likely already has colocation and peering infrastructure there.

---

## New Forward-Looking Thread: AI Gateway as the Next Expansion Stage

Growth-stage streaming and creator platforms increasingly explore AI-driven features — automated content moderation, live translation/captioning, personalized recommendations. None of that is part of *this* deal, but it's worth naming as the natural next conversation: a customer who just expanded into network-layer infrastructure (CNI, Load Balancer) is a strong candidate to be the next conversation about AI Gateway or Workers AI once they start building AI-powered features, for the same reason `se-intel`'s own Cycle 1 work demonstrates — once a platform is already running production traffic through Cloudflare's edge, adding AI inference at that same edge is a natural, low-friction next step rather than a new vendor evaluation.

---

## What to Add to Customer Discovery (Real-Time Video / Streaming)

1. **"What percentage of your ingestion traffic is WebRTC/low-latency vs. traditional RTMP, and how fast is that mix shifting?"** — sizes the urgency; a small-but-fast-growing WebRTC percentage is exactly the profile where a hairpin problem gets worse every quarter, not better.
2. **"Where does your origin/processing infrastructure live relative to your fastest-growing traffic regions?"** — surfaces the hairpin risk before it becomes a support escalation.
3. **"Have you looked at your traffic breakdown by facility? Is there one location that carries a clear plurality of your Cloudflare-bound traffic?"** — the CNI-siting question.
4. **"Are you seeing performance complaints concentrated in specific growth markets, and do you know if competitors serve those markets better?"** — a validated competitive gap is a strong forcing function, even inside a renewal (not just a net-new deal).
5. **"Is your product or leadership team exploring any AI-powered features — moderation, personalization, translation?"** — opens the AI Gateway/Workers AI thread as future pipeline, not this quarter's deal.

---

## What This Adds to the App Sec + CDN Pillar

The StyleLabs RFP covered: CDN, WAF, SSL for SaaS, Argo, basic DDoS, Logpush, Bandwidth Alliance — all delivery-side. `002-a` added Magic Transit and a security-consolidation angle. This scenario adds:

- **Cloudflare Network Interconnect (CNI)** — not covered anywhere else in the lab.
- **Real-time video/WebRTC ingestion architecture** — a genuinely different traffic pattern than cache-heavy delivery or security inspection.
- **Upsell/renewal deal mechanics** — every other win wire in the lab is net-new; this is the first expansion-on-an-existing-customer story.
- **A forward-looking AI Gateway hook** — ties the App Sec + CDN pillar's land-and-expand story forward into Pillar 4 (AI), rather than treating the four pillars as fully separate tracks.
