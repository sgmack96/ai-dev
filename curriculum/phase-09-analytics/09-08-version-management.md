# Module 9.8 — Version Management
> Dashboard Location: macksportreport.com → Analytics → Version Management (Zone Versioning)
> Estimated Time: 40 minutes
> Lab Domain: macksportreport.com

---

## Theory (SE-Level)

Zone Versioning (branded in the dashboard as "Version Management") is a configuration change management system for Cloudflare zones. It applies software engineering best practices — version control, staged rollouts, and rollback — to zone configuration changes like WAF rules, Cache Rules, Transform Rules, and Page Rules.

### The Problem Zone Versioning Solves

Traditional Cloudflare configuration changes are immediate and global:
- You enable a new WAF rule → it applies to 100% of traffic instantly
- You modify a Cache Rule → it affects every data center simultaneously
- If the change is wrong, you manually revert it while production traffic breaks

For high-traffic or mission-critical sites, this "all or nothing" deployment model is risky. Zone Versioning introduces controlled change management.

### Core Concepts

**Version:** A named snapshot of your zone's configuration at a point in time. Contains all rules, settings, and policies defined in the zone.

**Deployment:** The act of making a specific version active for a portion of traffic. A deployment has:
- A **target version** (the version to deploy)
- A **deployment scope** (what percentage or which specific colos receive this version)
- A **deployment status** (active, superseded, or rolled back)

**Staged rollout:** Deploying a new version to a small percentage of traffic first, monitoring it, then gradually increasing. Example: 1% → 10% → 50% → 100%.

**Rollback:** Reverting a deployment to a previous version. One click, near-instant.

### What Gets Versioned

Zone Versioning captures configuration changes including:

| Configuration Type | Versioned |
|-------------------|----------|
| WAF Custom Rules | Yes |
| WAF Managed Rules | Yes |
| Cache Rules | Yes |
| Page Rules | Yes |
| Transform Rules (URL rewrites, header mods) | Yes |
| Redirect Rules | Yes |
| Rate Limiting Rules | Yes |
| Configuration Rules | Yes |
| Bot Management settings | Yes |
| SSL/TLS mode | Yes |
| HTTP/2, HTTP/3 settings | Yes |

**What is NOT versioned:**
- DNS records
- Workers scripts (Workers use their own deployment system)
- Account-level settings
- Zone names/IDs

---

## Deep Dive (Architect-Level)

### How Traffic Is Split Between Versions

When you deploy a new version to X% of traffic, Cloudflare's edge consistently routes requests based on a hash of the visitor's IP + request attributes. This ensures:

- A given user consistently hits the same version (not randomly different versions per request)
- The split is statistically representative across geographies
- Cache behavior is predictable (requests for the same resource hit the same version)

This is similar to how A/B testing at the CDN layer works, but for configuration rather than content.

### The Audit Trail

Every action in Version Management is logged:
- **Who** created each version
- **When** each version was created
- **What changed** between versions (diff view)
- **Who deployed** each version
- **When** it was deployed
- **What percentage** of traffic received it
- **Whether it was rolled back** and by whom

This audit trail is invaluable for:
- **Incident post-mortems** (when did the config change that caused the outage?)
- **Compliance** (SOC 2, PCI DSS require change management documentation)
- **Team accountability** (who approved and deployed this WAF rule change?)

### Comparing Two Versions

The version diff view shows exactly what changed between any two versions:

```
Version 4 → Version 5 (deployed 2026-06-02 09:14 UTC by alice@company.com)

WAF Custom Rules:
  + ADDED: Rule "Block Log4Shell attempts" (action: block, expression: ...)
  
Cache Rules:
  ~ MODIFIED: "Cache API responses" — max-age changed from 60s to 300s

Rate Limiting:
  - REMOVED: "Legacy rate limit on /api/auth" (replaced by new rule)
```

This diff view is the change management record. In a compliance context, every production change should be deployable via Zone Versioning with an audit trail entry.

### Staged Deployment Use Case: Testing a New WAF Rule

**Scenario:** You want to add a new WAF rule to block requests with a specific header pattern that indicates scraping. But you're not confident the regex is correct, and a false positive would block legitimate traffic.

**Safe deployment with Zone Versioning:**

1. Create **Version 6** with the new WAF rule added
2. Deploy Version 6 to **1% of traffic** (minimum viable test)
3. Monitor for 30 minutes:
   - Check firewall events: are blocks occurring?
   - Check 5xx errors: are legitimate requests being blocked?
   - Check origin traffic: did the intended scrapers get blocked?
4. If healthy: increase deployment to **10%**, monitor for another 30 minutes
5. If healthy: increase to **50%**, then **100%**
6. If at any step there's a false positive: click **Rollback**, instantly reverting to Version 5

Total risk exposure: if the rule is wrong, only 1% of users experience it for 30 minutes before you catch it.

### Version Management vs Git for Config

Some customers ask: "Why not just use Git for configuration-as-code via Terraform?" The comparison:

| Feature | Zone Versioning | Terraform + Git |
|---------|----------------|-----------------|
| **Staged rollout** | Yes (native) | No (terraform apply is all-or-nothing) |
| **Instant rollback** | Yes (one click) | No (requires plan + apply) |
| **Diff view** | Yes (built-in) | Yes (terraform plan) |
| **Audit trail** | Yes (who deployed what, when) | Yes (git log + terraform state) |
| **Real-time traffic split** | Yes | No |
| **Requires code expertise** | No | Yes |
| **Infrastructure as Code** | No | Yes |
| **Multi-zone management** | Limited | Yes |

**Best practice:** Use both. Zone Versioning for safe, staged deployments with rollback capability. Terraform/Pulumi for Infrastructure as Code, drift detection, and multi-zone management. Zone Versioning is the deployment layer; Terraform is the source of truth.

### Enterprise Plan Requirement

Zone Versioning is an **Enterprise feature**. It's one of the key value propositions for Enterprise tier, particularly for:
- Large e-commerce sites that can't afford WAF configuration mistakes during peak traffic
- Financial services with strict change management compliance requirements
- Media/news sites where a bad WAF rule could block journalists or readers during a breaking news event

---

## Dashboard Walkthrough

### Step 1: Access Version Management

**Note:** Zone Versioning requires Enterprise plan. If on a lower plan, this section will be visible but the feature may not be available.

1. macksportreport.com → left nav → Versioning (or under a "Settings" section)
2. Alternative path: Analytics → Version Management

### Step 2: View Version History

The version list shows:
- Version number
- Created by (user email)
- Created at (timestamp)
- Description (optional change note)
- Current deployment status

### Step 3: Create a New Version

1. Click **Create Version**
2. Optionally: start from an existing version (clone) or from scratch
3. Give it a descriptive name: "Add bot protection rules — June 2026"
4. This creates a draft version you can modify

### Step 4: Make Changes to the Draft Version

In the draft version's context:
- Add a new WAF rule
- Modify a Cache Rule
- Update a Rate Limit
- All changes here do not affect live traffic

### Step 5: Deploy the Version

1. Click **Deploy**
2. Set deployment percentage: **5%** for initial test
3. Click **Confirm Deploy**
4. Monitor traffic and error rates for 30 minutes

### Step 6: Increase or Rollback

- **Increase:** Click the deployment and increase percentage
- **Rollback:** Click **Rollback** to instantly revert to the previous version

---

## Hands-On Lab

### Prerequisites

- Enterprise plan account
- macksportreport.com with some active traffic

### Lab 1: Verify Version Management is Available

```bash
# Check if Zone Versioning is available via API
export CF_API_TOKEN="your-api-token"
export ZONE_ID="your-zone-id"

curl -s "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/versions" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" | jq '.'

# If Enterprise: returns list of versions
# If not Enterprise: returns error or empty result
```

### Lab 2: List All Versions via API

```bash
# List all versions for the zone
curl -s "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/versions" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" | jq '.result[] | {
    version_id: .id,
    name: .name,
    created_at: .created_on,
    created_by: .created_by.email,
    description: .description
  }'
```

### Lab 3: Get Current Deployment Status

```bash
# Check what version is currently deployed and at what percentage
curl -s "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/versions/deployments" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" | jq '.result[] | {
    deployment_id: .id,
    version_id: .version_id,
    percentage: .environments[0].percentage,
    status: .status,
    deployed_at: .created_on
  }'
```

### Lab 4: Create and Deploy a Test Version (Simulated)

```bash
# Step 1: Get the current version ID to clone from
CURRENT_VERSION=$(curl -s "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/versions" \
  -H "Authorization: Bearer $CF_API_TOKEN" | jq -r '.result[0].id')

echo "Current version ID: $CURRENT_VERSION"

# Step 2: Create a new version (clone from current)
NEW_VERSION=$(curl -s -X POST \
  "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/versions" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data "{
    \"base_version_id\": \"$CURRENT_VERSION\",
    \"description\": \"Test version — lab exercise $(date -u +%Y-%m-%d)\"
  }" | jq -r '.result.id')

echo "Created new version ID: $NEW_VERSION"

# Step 3: Deploy to 5% of traffic
curl -s -X POST \
  "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/versions/$NEW_VERSION/deployments" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "environments": [
      {
        "name": "production",
        "percentage": 5
      }
    ]
  }' | jq '.result'
```

### Lab 5: Audit Trail Exercise

```bash
# Pull the deployment history with who did what
curl -s "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/versions/deployments" \
  -H "Authorization: Bearer $CF_API_TOKEN" | jq '.result | sort_by(.created_on) | .[] | {
    deployed_by: .created_by.email,
    version: .version_id,
    percentage: (.environments[0].percentage // "N/A"),
    at: .created_on,
    status: .status
  }'
```

---

## Demo Script (2 Minutes)

**Setup:** Zone Versioning dashboard open showing version history and a draft version ready.

---

"Let me show you what change management looks like for network security configuration.

[Point to version list]

Every change to this zone's configuration — WAF rules, cache settings, redirects — is tracked as a version. Version 12 was created Monday by alice@company.com. Version 13 was created Tuesday by bob@company.com. Each version has a full diff showing exactly what changed.

[Click to show version diff]

When Bob created Version 13, he added a new WAF rule to block a specific attack pattern. Here's the exact rule that was added, time-stamped, with Bob's name on it. This is your change management record — no spreadsheet, no email chain needed.

[Click on deployment view]

Now here's the important part. Bob didn't deploy this rule to 100% of traffic. He deployed it to 5% first. Why? Because a WAF rule that's too aggressive blocks legitimate users. You want to test it on a small percentage, verify there are no false positives, then roll it forward.

[Point to rollback button]

If something goes wrong at any step — one click, rollback. Instant. Not 'file a ticket, wait for someone to manually revert config.' One click.

For any customer running security config changes on a high-traffic site — this is what you need. Not Terraform, not config files — a production-safe deployment pipeline for WAF and cache rules."

---

## Competitive Context

| Feature | Cloudflare Zone Versioning | Fastly (Fiddle/Staging) | AWS WAF (Staging) | Akamai Ion |
|---------|--------------------------|------------------------|------------------|-----------|
| **Version history** | Yes | Limited | No | Yes |
| **Staged % rollout** | Yes | Yes (staging env) | No (full deploy) | Yes |
| **Instant rollback** | Yes (1-click) | Yes | No | Yes |
| **Diff view** | Yes | Limited | No | Yes |
| **Audit trail with user** | Yes | Yes | Yes (CloudTrail) | Yes |
| **Config-as-code integration** | Terraform limited | Yes (Fiddle API) | Yes (native IaC) | Yes |
| **Covers WAF + Cache + Redirects** | Yes (unified) | Separate systems | Separate systems | Yes |
| **Plan requirement** | Enterprise | Enterprise | Any | Enterprise |

---

## Self-Check Questions

**Question 1:** A customer's team made a WAF rule change directly in the Cloudflare dashboard (without using Zone Versioning) and it caused a service outage for 15 minutes. How would Zone Versioning have reduced the impact of this incident?

```
Your answer:




```

---

**Question 2:** A security engineer wants to add an aggressive bot blocking rule that might cause false positives. Walk through the safe deployment process using Zone Versioning, including what to monitor at each stage.

```
Your answer:




```

---

**Question 3:** A customer's compliance team requires documented change management for all WAF rule modifications (SOC 2 requirement). How does Zone Versioning satisfy this requirement, and what specific information does the audit trail capture?

```
Your answer:




```

---

**Question 4:** What is the difference between a "version" and a "deployment" in Zone Versioning? Can you have a version that has never been deployed?

```
Your answer:




```

---

**Question 5:** A customer is already using Terraform to manage their Cloudflare zone configuration. Should they switch to Zone Versioning instead, or use both? What is the recommended approach?

```
Your answer:




```

---

## Sources

- [Cloudflare Zone Versioning Documentation](https://developers.cloudflare.com/version-management/)
- [Zone Versioning API Reference](https://developers.cloudflare.com/api/operations/zone-versioning-list-versions)
- [Cloudflare Blog: Zone Versioning Launch](https://blog.cloudflare.com/zone-versioning/)
- [Terraform Cloudflare Provider](https://registry.terraform.io/providers/cloudflare/cloudflare/latest/docs)
- [Change Management Best Practices — ITIL](https://www.axelos.com/certifications/itil-service-management/)
- [Cloudflare Enterprise Plan Features](https://www.cloudflare.com/plans/enterprise/)
