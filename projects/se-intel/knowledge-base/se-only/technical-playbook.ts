/**
 * knowledge-base/se-only/technical-playbook.ts
 *
 * SE/TAM-only knowledge: technical deep-dives, POC patterns,
 * architecture decision guidance, and integration complexity maps.
 *
 * Accessible to: se, tam, sales_manager
 * NOT accessible to: ae, csm
 */

export interface KBChunk {
  id: string;
  text: string;
  metadata: {
    namespace: "se_only";
    topic: string;
    type: "poc-guide" | "architecture" | "objection" | "integration" | "competitive";
    keywords: string;
  };
}

export const seOnlyChunks: KBChunk[] = [

  // ── POC Patterns ────────────────────────────────────────────────────────────

  {
    id: "poc-workers-migration",
    text: "POC Pattern: AWS Lambda to Workers Migration. Week 1: Shadow mode deployment — deploy the Workers equivalent alongside Lambda, compare outputs for 1% of traffic. Validate parity before cutover. Week 2: Canary routing via Cloudflare Load Balancer — route 10% → 50% → 100% with health checks. Key success metrics: p99 latency < Lambda baseline, error rate < 0.1%, cold start frequency (should be 0). Common blockers: (1) Node.js built-in modules not in Workers (use `nodejs_compat` flag), (2) Functions over 30ms CPU need Durable Objects or Queues, (3) Secrets migration from AWS SSM to Wrangler Secrets. Time-to-value: 2-3 weeks for a typical Lambda function, 4-6 weeks for complex multi-function apps.",
    metadata: {
      namespace: "se_only",
      topic: "POC: Lambda to Workers",
      type: "poc-guide",
      keywords: "poc,lambda,migration,workers,timeline,success metrics,shadow mode,canary",
    },
  },
  {
    id: "poc-zero-trust-network",
    text: "POC Pattern: Zero Trust Network Access. Start with the highest-impact lowest-risk app: pick an internal tool (Jira, GitLab, internal dashboard) — not the core product. Phase 1 (Day 1-3): Deploy Cloudflare Access in front of one app. Use their existing IdP (Okta/Azure AD/Google Workspace). Add one allow policy. Zero infrastructure changes required. Phase 2 (Day 4-10): Add WARP client to a pilot group of 20-50 users. Configure Split Tunnel to route only internal IP ranges through Cloudflare Gateway. Measure: time-to-connect vs VPN, helpdesk tickets, user satisfaction. Phase 3 (Day 11-30): Expand Gateway DNS filtering. Add device posture checks. Evaluate Magic WAN for network segmentation. Success criteria: VPN tickets down >50%, connection time <2s, zero policy violations in pilot. Common blocker: IdP SAML configuration. Have the customer's IT admin on the call.",
    metadata: {
      namespace: "se_only",
      topic: "POC: Zero Trust Access",
      type: "poc-guide",
      keywords: "poc,zero trust,access,warp,gateway,vpn replacement,okta,azure ad,pilot",
    },
  },
  {
    id: "poc-cdn-migration",
    text: "POC Pattern: CDN Migration (Fastly/Akamai/CloudFront to Cloudflare). Critical first step: DNS change is the migration — there is no 'shadow mode' for a CDN unless you use Cloudflare in front of the existing CDN (orange-cloud proxy). Approach 1 (Recommended): Full cutover on a low-traffic subdomain (e.g., assets.staging.example.com) first. Validate cache hit rates, image optimization, performance. Approach 2: Cloudflare in front of existing CDN (temporary) — useful for WAF/bot management without CDN migration. Migration checklist: (1) Export existing Varnish/Fastly VCL rules → translate to Cloudflare Rules/Workers, (2) Map custom cache TTLs → Cache Rules, (3) Validate A/B test rules → Workers, (4) Purge strategy (Fastly instant purge vs Cloudflare instant purge via Cache API). Time: 1-2 days for simple CDN, 2-4 weeks for complex Varnish logic translation.",
    metadata: {
      namespace: "se_only",
      topic: "POC: CDN Migration",
      type: "poc-guide",
      keywords: "poc,cdn,migration,fastly,akamai,cloudfront,varnish,cache,dns cutover",
    },
  },

  // ── Architecture Patterns ────────────────────────────────────────────────────

  {
    id: "arch-multi-tenant-saas",
    text: "Architecture: Multi-Tenant SaaS on Cloudflare. Pattern: Workers for Platforms + Custom Hostnames + KV. Each tenant gets: (1) Custom hostname (tenant.example.com) registered via Custom Hostnames API, (2) Isolated Worker script via Workers for Platforms dispatch namespace, (3) Per-tenant KV namespace or D1 database row isolation. Tenant routing: Dispatch Worker reads `request.headers.get('host')` → looks up tenant config in KV → dispatches to tenant's Worker script. Security: Each tenant Worker runs in its own isolate, cannot access other tenant data. Pricing: Workers for Platforms is Enterprise-only, ~$0.50/million requests base + $5/month per 10M+ requests. Ideal for: white-label SaaS, partner API platforms, headless CMS multi-tenancy. Reference architecture: Shopify's Hydrogen storefront framework uses this pattern.",
    metadata: {
      namespace: "se_only",
      topic: "Architecture: Multi-tenant SaaS",
      type: "architecture",
      keywords: "saas,multi-tenant,workers for platforms,custom hostname,dispatch,isolation,enterprise",
    },
  },
  {
    id: "arch-global-api-gateway",
    text: "Architecture: Global API Gateway with Cloudflare. Stack: Workers (routing/auth) + API Shield (schema validation) + Rate Limiting + WAF + Analytics Engine. Request flow: Client → Cloudflare edge → Workers (JWT validation, rate limit check, routing logic) → API Shield (OpenAPI schema validation) → Origin API. Benefits over AWS API Gateway: no cold starts, global by default (vs single region), no VPC required, WAF and rate limiting are edge-native. Tradeoffs: Workers have 128MB memory limit (vs Lambda's configurable RAM), no managed auth (use Cloudflare Access or Workers for OAuth). Integration: For internal services behind a VPN, use Cloudflare Tunnel to expose them without opening firewall ports. Cost: $0.30/million requests (Workers) + $5/month (Rate Limiting) + $20/month (WAF) — typically 60-80% cheaper than AWS API GW at scale.",
    metadata: {
      namespace: "se_only",
      topic: "Architecture: API Gateway",
      type: "architecture",
      keywords: "api gateway,global,routing,jwt,rate limiting,waf,schema validation,api shield,tunnel",
    },
  },
  {
    id: "arch-rag-pipeline",
    text: "Architecture: RAG Pipeline on Cloudflare. Components: Vectorize (vector DB) + Workers AI (embeddings + generation) + R2 (document storage) + D1 (metadata) + Workers (orchestration). Pipeline: (1) Ingestion: Document → Workers → split into chunks → Workers AI (BGE-base-en-v1.5, 768 dims) → embed → Vectorize upsert. R2 stores raw documents. D1 stores chunk metadata. (2) Retrieval: Query → embed → Vectorize query (topK=5, cosine similarity) → fetch chunk content → inject into prompt → Workers AI (Llama 3.3 70B) → response. Performance: Embedding ~50-100ms, Vectorize query ~30-50ms, LLM generation 5-15s (Llama 70B). Limit: Vectorize max 5M vectors per index, max 1536 dimensions. For larger indexes: partition by namespace. Cost: Free tier includes 30M queried vectors/month. Paid: $0.04/million vectors stored/month + $0.01/million vectors queried.",
    metadata: {
      namespace: "se_only",
      topic: "Architecture: RAG Pipeline",
      type: "architecture",
      keywords: "rag,vectorize,embedding,workers ai,llm,retrieval,pipeline,ingestion,similarity search",
    },
  },

  // ── Technical Objection Handling ────────────────────────────────────────────

  {
    id: "objection-vendor-lock-in",
    text: "Objection: 'We don't want vendor lock-in to Cloudflare.' Response: Cloudflare Workers use standard Web APIs (fetch, crypto, cache) and WinterCG-compliant APIs — the same code runs on Deno, Bun, and any WinterCG runtime. The Cloudflare-specific bindings (KV, D1, R2) have open-spec equivalents: KV → any Redis API, D1 → SQLite (fully portable), R2 → S3-compatible API. Workers can call any external API — you're not locked into Workers AI or Vectorize. If a customer leaves Cloudflare: their Worker code runs on any edge runtime with minor changes (swap CF bindings for equivalent services). Stronger counter: AWS Lambda uses Node.js with proprietary SDK, Aurora is not portable, API Gateway config is not transferable. The real lock-in question is which provider's operational complexity you're most comfortable managing.",
    metadata: {
      namespace: "se_only",
      topic: "Objection: Vendor Lock-in",
      type: "objection",
      keywords: "vendor lock-in,portability,standards,wintercg,open source,alternative,exit strategy",
    },
  },
  {
    id: "objection-enterprise-readiness",
    text: "Objection: 'Cloudflare isn't enterprise-ready / mature enough.' Response framework: (1) Scale proof: Cloudflare handles 20%+ of all internet traffic, including Shopify's global CDN, Discord's network, and 20% of Fortune 1000 companies. (2) Compliance: SOC 2 Type II, ISO 27001, FedRAMP Moderate (for Government), PCI DSS Level 1, HIPAA-eligible. (3) SLA: 100% uptime SLA for Enterprise tier on network availability. 4-hour response SLA for P1 incidents. (4) Data residency: Regional Services, Geo Key Manager for crypto key locality, Jurisdiction Restrictions for Workers. (5) Support: 24/7 Enterprise support, named CSM, TAM availability. Common follow-up: 'What specific enterprise requirements are you evaluating?' — get specific rather than arguing against a vague concern.",
    metadata: {
      namespace: "se_only",
      topic: "Objection: Enterprise Readiness",
      type: "objection",
      keywords: "enterprise,soc2,compliance,uptime,sla,fedRAMP,hipaa,pci,data residency,support",
    },
  },
  {
    id: "objection-workers-limits",
    text: "Objection: 'Workers has too many limits — CPU time, memory, no filesystem.' Response: Workers limits exist because they're isolate-based, not container-based — they're what makes sub-5ms cold starts possible. Most limits aren't blockers once you know the workarounds. CPU time limit (30ms): 99% of API handlers finish in <10ms. For heavier work, use Durable Objects (no CPU time limit for single requests) or queue the work with Cloudflare Queues. Memory (128MB): Sufficient for most request handlers. For stateful computation, use Durable Objects. No filesystem: Use R2 (object storage), D1 (SQLite), or KV (key-value) instead. If a customer hits these limits legitimately, they're building something that benefits from the alternative Cloudflare products (Durable Objects, Queues, R2) — turn limits into upsell opportunities.",
    metadata: {
      namespace: "se_only",
      topic: "Objection: Workers Limits",
      type: "objection",
      keywords: "workers limits,cpu time,memory,filesystem,durable objects,queues,workarounds,constraints",
    },
  },

  // ── Integration Complexity Maps ──────────────────────────────────────────────

  {
    id: "integration-auth0-to-access",
    text: "Integration: Auth0/Okta → Cloudflare Access. Complexity: Low (1-2 days). Auth0 and Okta are the most common IdP integrations. Cloudflare Access supports both as SAML and OIDC providers. Steps: (1) Create an Okta/Auth0 Application of type 'SAML 2.0' or 'OIDC'. (2) Set ACS URL to https://<your-team>.cloudflareaccess.com/cdn-cgi/access/callback. (3) In Cloudflare Access, create an Identity Provider with type Okta/Auth0. (4) Create an Access Application protecting the internal service. (5) Create an Access Policy with the IdP as the source. Gotcha: Auth0 free tier doesn't include SAML — need at least the Essential plan ($35/month). Enterprise IdPs (Ping, ADFS, CyberArk): Same SAML flow but often has custom attribute mappings that require troubleshooting. Allow 4-8 hours extra for enterprise IdP integrations.",
    metadata: {
      namespace: "se_only",
      topic: "Integration: Auth0/Okta to Access",
      type: "integration",
      keywords: "auth0,okta,saml,oidc,access,identity provider,sso,integration,setup",
    },
  },
  {
    id: "integration-terraform",
    text: "Integration: Terraform for Cloudflare. The Cloudflare Terraform provider (registry.terraform.io/providers/cloudflare/cloudflare) supports all major resources: zones, DNS records, Workers, KV namespaces, D1 databases, Access applications/policies, WAF rules, Load Balancers, Tunnels. Common patterns: (1) Zone management in Terraform, Worker code deployed via Wrangler (Wrangler is faster for CI/CD), (2) Access policies as code — critical for audit compliance, (3) Firewall/WAF rules as code — prevents 'who changed that rule?' incidents. Limitations: Vectorize indexes are NOT yet in the Terraform provider (use Wrangler CLI). Workers AI bindings are in the provider. Selling point for enterprise: 'Cloudflare as code' means all security policy is version-controlled, auditable, and reviewable via PR.",
    metadata: {
      namespace: "se_only",
      topic: "Integration: Terraform",
      type: "integration",
      keywords: "terraform,iac,infrastructure as code,gitops,cicd,automation,provider,wrangler,deployment",
    },
  },

  // ── Competitive Deep-Dives ────────────────────────────────────────────────────

  {
    id: "competitive-fastly-technical",
    text: "Competitive: Cloudflare vs Fastly (Technical). Fastly strengths: Instant Purge API is genuinely faster than Cloudflare's (propagation in ~150ms vs up to 5s on Cloudflare free/pro, instant on Enterprise). Varnish Configuration Language (VCL) gives very granular cache control. Fastly weaknesses: Compute@Edge uses Wasm only — no full JavaScript runtime, no Node.js compat. No edge database (no equivalent to KV, D1, Durable Objects). Security product is bolt-on via partnerships, not native. No SASE/Zero Trust offering. Cloudflare advantages for Fastly switchers: Full JavaScript/TypeScript/Python runtime at edge, native security stack (WAF + Bot + DDoS + Access in one platform), global Anycast network vs Fastly's anycast-only for Premium tier, AI capabilities (Workers AI, AI Gateway, Vectorize) with no Fastly equivalent. Key wedge: 'Are you using Compute@Edge?' If yes, they're likely frustrated by Wasm-only limitations.",
    metadata: {
      namespace: "se_only",
      topic: "Competitive: Fastly",
      type: "competitive",
      keywords: "fastly,competitive,varnish,vcl,compute at edge,wasm,cdn,cache,purge,comparison",
    },
  },
  {
    id: "competitive-akamai-technical",
    text: "Competitive: Cloudflare vs Akamai (Technical). Akamai strengths: Largest network by node count (~4,000 POPs vs Cloudflare's 300+), longest enterprise relationships, EdgeWorkers for compute (limited), media delivery at extreme scale. Akamai weaknesses: EdgeWorkers is limited — no persistent storage, no bindings ecosystem, V8-based but with heavy restrictions. Pricing is opaque and negotiation-heavy (enterprise contracts, not self-serve). Configuration requires Akamai-certified professionals or their PS team (high switching cost, but also high lock-in for customers). Portal is notoriously complex. Security products are bolted on via acquisition (Guardicore, Linode, etc.). Cloudflare advantages vs Akamai: Self-serve deployment (no PS dependency), unified platform (CDN + security + compute + network in one dashboard), predictable usage-based pricing, Workers ecosystem vastly more capable than EdgeWorkers, faster innovation cycle. Key wedge: Long Akamai customers are frustrated by complexity and PS dependency. Ask 'How long does it take to push a configuration change to production?'",
    metadata: {
      namespace: "se_only",
      topic: "Competitive: Akamai",
      type: "competitive",
      keywords: "akamai,competitive,edgeworkers,enterprise,cdn,security,pricing,complexity,professional services",
    },
  },
];
