/**
 * knowledge-base/manager-only/deal-strategy.ts
 *
 * Manager-only knowledge: pricing guidelines, discount frameworks,
 * deal strategy, win/loss patterns, and escalation playbooks.
 *
 * Accessible to: sales_manager ONLY
 * NOT accessible to: ae, csm, se, tam
 *
 * Note: No real Cloudflare pricing data here — these are illustrative
 * frameworks for portfolio demo purposes.
 */

export interface KBChunk {
  id: string;
  text: string;
  metadata: {
    namespace: "manager_only";
    topic: string;
    type: "pricing" | "deal-strategy" | "win-loss" | "escalation" | "coaching";
    keywords: string;
  };
}

export const managerOnlyChunks: KBChunk[] = [

  // ── Pricing Frameworks ────────────────────────────────────────────────────────

  {
    id: "pricing-discount-framework",
    text: "Discount Framework (Enterprise Deals). Standard approval tiers: (1) AE authority: up to 10% off list. No approval needed. (2) Sales Manager authority: 10-25% off list. Requires business justification in SFDC. Response within 24 hours. (3) VP Sales / Deal Desk: 25-40% off list. Requires competitive intelligence, strategic account brief, and multi-year commit. 3-5 business day turnaround. (4) Executive sponsorship: >40% off list. Reserved for strategic logos, competitive displacement of major provider, or public reference commitments. 1-2 week process. Discount triggers that accelerate approval: multi-year contract (2yr = +5%, 3yr = +10% additional), committed public reference, case study, or logo usage rights. Anti-patterns: discounting before qualification, discounting on first ask without exploring value, discounting to win a deal you haven't properly qualified.",
    metadata: {
      namespace: "manager_only",
      topic: "Pricing: Discount Framework",
      type: "pricing",
      keywords: "discount,pricing,approval,deal desk,authority,multi-year,escalation,negotiation",
    },
  },
  {
    id: "pricing-competitive-displacement",
    text: "Pricing Strategy: Competitive Displacement. When displacing an incumbent (Akamai, Fastly, AWS WAF/CloudFront): Framing: Lead with TCO (Total Cost of Ownership) not list price. Include: current vendor cost + PS fees + configuration complexity cost + internal engineering time. Cloudflare typically 40-60% cheaper on CDN/security than Akamai like-for-like. Fastly: closer to parity on CDN, but Cloudflare is cheaper when bundling security + compute. AWS CloudFront + WAF + Lambda@Edge bundled vs Cloudflare Workers + WAF: Cloudflare is typically 30-50% cheaper at mid-market scale. Negotiation leverage: competitive bids (even if not serious), end-of-quarter timing, multi-product bundling (CDN + security + Zero Trust = larger discount justification), and executive relationships. Red flags: prospect who only wants to use pricing as leverage to renew with incumbent — qualify intent before investing in deep pricing exercises.",
    metadata: {
      namespace: "manager_only",
      topic: "Pricing: Competitive Displacement",
      type: "pricing",
      keywords: "competitive displacement,tco,akamai,fastly,aws,pricing comparison,negotiation,bundling",
    },
  },

  // ── Deal Strategy ─────────────────────────────────────────────────────────────

  {
    id: "deal-strategy-land-and-expand",
    text: "Deal Strategy: Land and Expand. Cloudflare's most successful motion is landing on one product and expanding to the platform. Common landing products by segment: Startups: Workers or AI Gateway (high-velocity, developer-led). Mid-market: CDN + WAF bundle or Zero Trust Access pilot. Enterprise: Security (DDoS + WAF) displacing an existing WAF, or Zero Trust Network Access pilot. Expansion triggers to watch for: (1) CDN customer → ask about edge compute needs → Workers upsell. (2) WAF customer → ask about API security → API Shield upsell. (3) Workers customer → ask about data storage → R2, D1, KV upsell. (4) Any security customer → ask about remote access/VPN → Zero Trust upsell. Expansion velocity: Customers who start with one product and get value typically expand within 6-12 months. Build expansion plan into initial contract — annual review cadence, named expansion contacts.",
    metadata: {
      namespace: "manager_only",
      topic: "Deal Strategy: Land and Expand",
      type: "deal-strategy",
      keywords: "land and expand,upsell,expansion,platform,motion,cloudflare one,bundles,cross-sell",
    },
  },
  {
    id: "deal-strategy-champion-building",
    text: "Deal Strategy: Building a Champion. Without a champion, there is no deal. Champion criteria (MEDDIC): (1) Has access to power — can get a meeting with the economic buyer. (2) Owns the problem — feels personal pain from the current situation. (3) Believes in the solution — has seen the demo, tested the POC. (4) Has something to gain — career advancement, budget relief, technical credibility. Finding champions: Engineering/Platform teams for Workers/security, CISO/Security for Zero Trust, CTO/VP Eng for network/CDN. Champion development activities: Get them early access or beta features, include them in roadmap discussions, make them look good internally (prepare them for the internal pitch), co-create the business case. Warning signs the 'champion' isn't real: They don't know who the economic buyer is, they've never introduced you to another stakeholder, they always say 'I'll find out' but never follow up.",
    metadata: {
      namespace: "manager_only",
      topic: "Deal Strategy: Champion Building",
      type: "deal-strategy",
      keywords: "champion,meddic,economic buyer,power,stakeholder,internal sponsor,qualification",
    },
  },

  // ── Win/Loss Patterns ─────────────────────────────────────────────────────────

  {
    id: "win-pattern-technical-poc",
    text: "Win Pattern: Technical POC Win. The pattern: SE runs a tight, scoped POC in 2-3 weeks. Success criteria defined in writing before starting. Success criteria are met and documented. This is the highest-win-rate close path for deals over $50K ACV. POC best practices from win analysis: (1) Never start a POC without written success criteria — both parties sign off. (2) Set a decision timeline upfront — 'If the POC succeeds, can we agree to proceed by [date]?' (3) Keep POC scope minimal — one use case, one product, clear success metric. Scope creep kills POCs. (4) Daily check-ins during the POC — don't let it go dark for a week. (5) Document everything — screenshots, latency measurements, test results. The POC report becomes the business case. Common POC failure modes: No success criteria agreed upfront, scope expanded mid-POC, no champion to defend results internally, economic buyer not involved until after POC.",
    metadata: {
      namespace: "manager_only",
      topic: "Win Pattern: Technical POC",
      type: "win-loss",
      keywords: "poc,win,success criteria,technical proof,close,rate,best practices,scope",
    },
  },
  {
    id: "loss-pattern-no-champion",
    text: "Loss Pattern: No Champion / Wrong Champion. The most common reason deals over $50K are lost: no real champion with access to power. Indicators you're working with the wrong champion: (1) They can't get budget conversation on calendar with economic buyer. (2) Every update is 'I'm still working on it internally.' (3) They disappear for 2+ weeks without warning. (4) They haven't shared the business case with anyone above them. Coaching action: Force a 'champion test' at 30 days — ask them to co-present the business case to their VP in a 30-minute call. Real champions will do this. Fake champions will delay. If the champion fails the test: escalate to find another entry point (different department, different problem), get executive alignment via your own VP relationship, or disengage and re-qualify from scratch. Never let a deal sit with an inactive champion for more than 30 days.",
    metadata: {
      namespace: "manager_only",
      topic: "Loss Pattern: No Champion",
      type: "win-loss",
      keywords: "champion,loss,deal risk,stalled,inactive,escalation,qualification,meddic",
    },
  },

  // ── Escalation Playbooks ──────────────────────────────────────────────────────

  {
    id: "escalation-security-incident",
    text: "Escalation: Prospect Has Active Security Incident. If a prospect is currently experiencing a DDoS attack, data breach, or infrastructure outage: (1) Activate the Emergency Onboarding process — Cloudflare can onboard a new customer and have DNS proxied in under 2 hours for basic CDN + DDoS. Contact your regional Sales Director and Technical Support to open an emergency track. (2) Do NOT send a standard proposal in this situation — offer an emergency trial/bridge agreement. The legal and pricing are negotiated after the incident. (3) Assign an SE immediately for real-time technical assistance. (4) Document everything — timing, severity, customer contact, actions taken. This becomes a case study. Incidents that go well become some of the strongest long-term customer relationships. Incidents handled poorly result in churn AND public negative feedback. When in doubt: over-resource the response, deal with the paperwork later.",
    metadata: {
      namespace: "manager_only",
      topic: "Escalation: Security Incident",
      type: "escalation",
      keywords: "escalation,incident,ddos,security,emergency,onboarding,response,bridge agreement",
    },
  },
  {
    id: "escalation-executive-sponsor",
    text: "Escalation: Getting Executive Sponsorship for a Stalled Deal. When a deal stalls at mid-level and needs executive air cover: Criteria for escalation request: Deal is $200K+ ACV, has been in pipeline >90 days without movement, champion has confirmed budget but can't get final approval. Process: (1) Brief your VP/RVP on the account — strategic value, competitive situation, champion quality, blocker. (2) Request a C-level introduction — Cloudflare CEO, CRO, or regional VP meeting with their CISO/CTO/CEO. (3) Prepare a tight executive brief: 1-page problem/solution/value/ask. No product demos at this level. (4) The ask should be specific: 'We need a decision by [date]. Can you have a 30-minute call with their CTO to unlock this?' Anti-pattern: using executive escalation too early (kills champion's credibility) or too late (deal already lost). Timing: escalate when champion has exhausted internal options, not as first move.",
    metadata: {
      namespace: "manager_only",
      topic: "Escalation: Executive Sponsorship",
      type: "escalation",
      keywords: "executive,sponsor,escalation,stalled deal,ceo,cto,ciso,air cover,vp meeting",
    },
  },

  // ── Coaching Frameworks ───────────────────────────────────────────────────────

  {
    id: "coaching-deal-review",
    text: "Coaching: Weekly Deal Review Framework. For each deal in forecast: (1) MEDDIC score (1-5): M=Metrics defined? E=Economic buyer identified? D=Decision criteria documented? D=Decision process mapped? I=Identify pain? C=Champion quality? (2) Next action: Is there a specific, time-bound next step with a date and owner? 'Following up next week' is not a next action. (3) Risk: What's the #1 reason this deal doesn't close? What's being done about it? (4) Path to close: If close date is in 30 days, can you map every step from today to signed contract? Weekly deal review red flags: AE hasn't spoken to champion in 7+ days, next action is AE-owned (should be customer-owned), close date keeps slipping without explanation, no executive sponsor on deals >$100K, technical validation (POC) not completed for deals >$50K.",
    metadata: {
      namespace: "manager_only",
      topic: "Coaching: Deal Review Framework",
      type: "coaching",
      keywords: "deal review,meddic,forecast,pipeline,coaching,next action,risk,close date",
    },
  },
];
