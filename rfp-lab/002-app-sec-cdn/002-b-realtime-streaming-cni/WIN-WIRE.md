# Win Wire 002-b — Network Interconnect Expansion, Real-Time Streaming Platform
> **Pillar:** Application Security + CDN
> **Pattern:** Upsell/renewal expansion — Cloudflare Network Interconnect (CNI) + Load Balancer, existing customer
> **Fully fictional composite** — see `WHAT-CHANGED.md`. No company, employee, or customer detail below refers to anything real.

---

## Customer Profile

- **Industry:** Live-streaming platform for creator-hosted events and interactive shows
- **Size:** High-growth, venture-backed scale-up; global audience, hundreds of thousands of concurrent viewers at peak
- **Stack:** Multi-year Cloudflare customer — SSL for SaaS (multi-tenant creator subdomains), CDN, Load Balancer, Enterprise plan
- **Engineering culture:** Strong in-house engineering team, build-vs-buy instinct, technically sophisticated buyer

---

## Products Purchased (Expansion)

- **Cloudflare Network Interconnect (CNI)** — new, dedicated interconnect at the customer's primary colocation facility
- **Load Balancer plan expansion** — bundled in, resolving an existing plan-limit constraint
- **(Renewed)** SSL for SaaS, CDN, Enterprise plan — existing footprint, carried forward on the same renewal

---

## What Was Considered (Not a Displacement — an Upsell)

Unlike the other win wires in this lab, there was no incumbent vendor to unseat. The real alternatives the customer was weighing:

- **Build the interconnect/peering relationship themselves** — technically possible given their engineering maturity, but a distraction from product differentiation
- **Bring in a narrow point-solution vendor** just for the interconnect piece — would have meant correlating logs and negotiating terms across yet another vendor, disconnected from the CDN/Load Balancer traffic already running through Cloudflare
- **Do nothing and accept the growing latency problem** — the default outcome if the renewal had gone through flat, without anyone connecting the dots between the hairpin complaints and a network-layer fix

---

## Core Pain

Two converging, compounding factors:

**1. A fast-growing traffic type was hitting an architecture that wasn't built for it.**
The customer's newer WebRTC-based ingestion path (a small but rapidly growing share of total traffic) was routing through a centralized origin instead of staying regional — a "hairpin" that defeated the entire point of choosing a low-latency ingestion protocol. The problem was small in absolute terms but structurally guaranteed to get worse as WebRTC adoption grew, not better.

**2. Regional infrastructure capacity was constrained exactly when it mattered most.**
The growth market generating the hairpin traffic was also experiencing point-of-presence capacity constraints during peak hours — so during the moments with the highest revenue exposure, traffic was getting rerouted on top of already being hairpinned. Two independent problems compounding at the worst possible time.

---

## How We Won

**Technical:** Cloudflare Network Interconnect (CNI) at the facility already carrying the majority of the customer's Cloudflare-bound traffic — the path of least resistance, since the customer already had colocation and peering infrastructure there. One piece of infrastructure solved both problems: dedicated capacity (no more competing with the shared public PoP pool during peak) and direct routing control (the customer could finally keep regional traffic regional instead of bouncing it through a centralized origin).

**Commercial:** Bundled a Load Balancer plan expansion into the same renewal conversation — a constraint the customer was already going to need addressed for their broader infrastructure roadmap, packaged alongside CNI rather than negotiated as a separate deal.

**Relationship:** Because this was an existing, trusted customer, the sales motion looked completely different from a competitive win — no bake-off, no side-by-side POC against an incumbent. The conversation was purely technical: does this specific capability solve this specific, already-diagnosed problem. That's a faster, higher-trust motion than a net-new evaluation, and it's the more common motion in practice for a platform that's already invested in the relationship.

---

## The Hard Part

**Diagnosing the compounding problem, not just the obvious one.** The customer initially framed this purely as a "your regional capacity is bad" complaint. The hairpin routing issue only surfaced once the traffic architecture was walked through in detail — it would have been easy to solve the capacity complaint in isolation and leave the architectural hairpin problem to keep getting worse as WebRTC traffic grew. The lesson: a performance complaint is often a symptom of two problems, not one, and a single fix that only addresses the surface complaint leaves the underlying trend line unresolved.

**Bundling without over-complicating.** The Load Balancer expansion was a real, separate need — but bundling it into the CNI conversation had to be done carefully so it read as "we're solving your infrastructure roadmap holistically" rather than "we're using one problem to upsell you into buying something unrelated."

---

## Timeline

- Renewal cycle begins; regional performance complaints already on file from the customer's support escalations
- Technical architecture review surfaces the hairpin routing pattern underneath the capacity complaint
- CNI proposed as a single fix for both the capacity constraint and the routing problem
- Facility selection: traffic-breakdown analysis identifies the customer's primary colocation facility as the clear majority of Cloudflare-bound traffic — obvious CNI location
- Load Balancer expansion bundled into the same conversation
- Renewal signed with both expansion products included, ahead of the original renewal date

---

## The Soundbite

*"An existing customer — a high-growth live-streaming platform — came into their renewal with a performance complaint about one region. Digging into the architecture, we found it wasn't just a capacity problem: their fastest-growing traffic type was hairpinning through a centralized origin, and it was going to get worse every quarter as that traffic grew. We fixed both with a single dedicated network interconnect at the facility that already carried most of their traffic, bundled a Load Balancer expansion they needed anyway, and turned a flat renewal into an expansion — without a single competitive bake-off, because the trust was already there."*
