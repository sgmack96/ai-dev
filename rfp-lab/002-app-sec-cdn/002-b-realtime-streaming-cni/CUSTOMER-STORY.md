# Customer Story — 002-b Real-Time Streaming, CNI Expansion

> **Note:** fully fictional composite — see `WHAT-CHANGED.md`. No detail below traces to any real account.

---

## 30-Second Version
*Use in cold outreach, first meeting, or when asked "do you have experience with real-time video/streaming platforms?"*

"We recently helped a high-growth live-streaming platform — already a multi-year Cloudflare customer — fix a latency problem that was getting worse every quarter. Their newer, low-latency ingestion traffic was hairpinning through a centralized origin instead of staying regional, right as it was becoming their fastest-growing traffic type. We solved it with a dedicated network interconnect at the facility that already carried most of their traffic — fixed the routing and the underlying capacity constraint in the same move, and expanded the relationship on renewal instead of it just being a standstill contract renewal."

---

## 2-Minute Version
*Use in discovery when they're evaluating CDN/network performance, or are already a customer considering expansion.*

"Let me walk you through an expansion we did with an existing customer — a live-streaming platform for creator-hosted events, high growth, technically sophisticated team that builds a lot of their own infrastructure.

They'd been a customer for years — SSL for SaaS for their multi-tenant creator subdomains, CDN, Load Balancer. Nothing unusual there. The interesting part was a newer piece of their traffic: they'd started ingesting a small but fast-growing percentage of streams over WebRTC instead of traditional RTMP, because it's lower latency — better for interactive, real-time content. But their WebRTC ingestion points weren't geographically matched to where that traffic was actually coming from. A broadcaster in a fast-growing market would connect to a nearby edge point, but the traffic would then route all the way to their centralized origin and hairpin back — even when the viewer was in the same region as the broadcaster. That's the exact latency their low-latency protocol was supposed to eliminate, and it was getting worse every quarter as WebRTC adoption grew.

It got worse because their regional point-of-presence capacity was also constrained during peak hours in that same growth market — so during exactly the moments that mattered most for their business, traffic was getting rerouted even further, compounding the hairpin problem with a capacity problem.

We fixed both with one thing: a dedicated network interconnect — a direct physical/BGP handoff at the colocation facility that already carried the majority of their traffic. That gave them dedicated capacity, so they weren't competing with the public network during peak hours, and it gave them routing control, so they could keep regional traffic regional instead of bouncing it through a centralized origin.

We bundled a Load Balancer plan expansion into the same conversation, since they were already at their limit and it was blocking some of the routing optimization work anyway. And because they're a growth-stage platform, their leadership was starting to talk about AI-powered features — content moderation, personalization — which is a natural next conversation once a platform is already running production traffic through the edge.

The deal itself wasn't a competitive win — there was no vendor to displace, they were already a customer. It was an upsell on renewal: expand the relationship instead of letting it just auto-renew flat."

---

## When to Use This Story

| Customer Situation | Why This Story Works |
|---|---|
| Existing customer, renewal conversation | Direct template for "expand the relationship instead of renewing flat" |
| Real-time video / streaming / interactive media platform | Technical pattern (hairpin routing, WHIP vs. RTMP mix) is specific and credible |
| Growing WebRTC/low-latency traffic percentage | The "small but fast-growing" framing directly maps to their own traffic mix conversation |
| Regional performance complaints in a specific growth market | Capacity + hairpin compounding story is a concrete diagnostic, not a generic pitch |
| Sophisticated, build-vs-buy engineering culture | Story leads with architecture and root cause, not a sales pitch — matches how technical teams want to be sold to |
| Platform starting to explore AI-driven product features | Natural bridge into an AI Gateway/Workers AI conversation without forcing it into this quarter's deal |

---

## The Competitive/Positioning Talking Points (Build vs. Buy, Not Vendor Displacement)

Because this is an upsell on an existing relationship, there's no incumbent to talk down — the real internal competitor is **"build it ourselves"** or **"add a narrow point-solution vendor for just this problem."** The talking points reflect that:

**Why not build a dedicated interconnect/peering setup themselves:** "You already have the engineering talent to do this — the question is whether it's the highest-leverage use of that talent. A direct interconnect is infrastructure, not product. The differentiated part of your business is what you build on top of low-latency ingestion, not the interconnect itself."

**Why not just add a point-solution CDN/interconnect vendor instead of expanding with the incumbent:** "You'd be adding a third or fourth vendor to correlate logs against, negotiate separately, and integrate with your existing Cloudflare-fronted traffic. The interconnect only helps if it's talking to the same network your CDN, Load Balancer, and SSL are already running on — otherwise you've just moved the hairpin problem to a different boundary."

**Why the timing (renewal) matters:** "This isn't a new sales cycle — it's the same technical team, the same account history, the same trust. The bar to prove value is lower because the relationship already exists; the bar that matters is whether this specific new capability solves their specific new problem, which is a much more concrete conversation than a from-scratch vendor evaluation."

**The forward-looking AI angle (not this deal, but worth naming):** "Once you're running production real-time traffic through the edge, adding AI inference at that same edge — content moderation, live captioning, personalization — is a much smaller step than starting a new AI infrastructure evaluation from scratch. That's usually the next conversation with platforms like this, not this one."
