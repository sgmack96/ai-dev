# Module 13.3 — Audit Logs
> Dashboard Location: Account Home → Audit Logs | Estimated Time: 45 min | Lab Domain: macksportreport.com

---

## Theory (SE-Level)

Cloudflare Audit Logs record every action taken in the Cloudflare dashboard or via API — who did what, when, and from where. This is your immutable record of configuration changes, user actions, and administrative events.

**Why audit logs exist:**

1. **Incident investigation:** A WAF rule was deleted. The CDN cache settings changed. DNS records were modified. Audit logs tell you exactly who made the change and when — enabling rapid root cause analysis.

2. **Compliance requirements:** SOC 2, PCI-DSS, ISO 27001, HIPAA — all require demonstrating that changes to systems are logged and attributable to specific individuals. Audit logs are your evidence trail.

3. **Security monitoring:** Unusual logins, API token usage from new IPs, changes made outside business hours — audit logs feed into your SIEM for anomaly detection.

4. **Change management:** Track that changes were made by authorized users via approved processes, not rogue actors or compromised credentials.

**What gets logged:** Every action that modifies Cloudflare configuration:
- DNS record created, updated, deleted
- WAF rule created, modified, deleted
- Page Rule added or removed
- SSL setting changed
- Cache purge requested
- User added to or removed from account
- API token created or deleted
- Billing information changed
- Zone created or deleted
- Worker deployed or deleted
- Zero Trust policy modified
- Cloudflare Tunnel created or removed

**What does NOT get logged:** Traffic events (individual HTTP requests, DDoS packets) — those are in Analytics and Firewall Events. Audit Logs are about configuration and administrative actions, not traffic.

---

## Deep Dive (Architect-Level)

### Data Structure

Each audit log entry contains:

```json
{
  "id": "event-uuid",
  "action": {
    "type": "delete",
    "result": true,
    "info": {
      "name": "rule-name",
      "id": "rule-uuid"
    }
  },
  "actor": {
    "email": "admin@macksportreport.com",
    "id": "user-uuid",
    "ip": "203.0.113.5",
    "type": "user"
  },
  "interface": "UI",
  "metadata": {
    "zone_name": "macksportreport.com"
  },
  "newValue": null,
  "oldValue": "{\"expression\":\"ip.src in {1.2.3.4}\",\"action\":\"block\"}",
  "owner": {
    "id": "account-uuid"
  },
  "resource": {
    "id": "rule-uuid",
    "type": "firewall.rule"
  },
  "when": "2024-11-15T14:32:11Z"
}
```

Key fields:
- `actor.email` — who made the change (human user or API token name)
- `actor.type` — "user" (human), "service_token" (API token), "cloudflare" (CF internal)
- `actor.ip` — source IP of the request that made the change
- `interface` — "UI" (dashboard) or "API" (programmatic)
- `action.type` — create, update, delete, login, logout, etc.
- `resource.type` — what was changed (firewall.rule, dns.record, etc.)
- `oldValue` / `newValue` — what the configuration was before and after (for supported resource types)

### Retention and Export

- **Retention:** 6 months in Cloudflare dashboard
- **Export options:**
  - Manual download from dashboard (CSV/JSON)
  - REST API for programmatic access
  - Logpush for real-time streaming to SIEM, S3, BigQuery, etc.

For compliance, you likely need longer retention. The recommended architecture:
```
Cloudflare Audit Logs (6 months in CF)
   → Logpush (real-time streaming)
   → AWS S3 / R2 (unlimited retention, archival)
   → Splunk / Elastic / Datadog (searchable SIEM, 12-24 months)
```

### Actor Types

| Actor Type | Description | What it Means |
|---|---|---|
| `user` | Human dashboard/API user | Employee made change |
| `service_token` | API token | Automated script or CI/CD |
| `cloudflare` | Internal Cloudflare system | Platform maintenance, cert auto-renewal |
| `cf_service_token` | Internal CF service | Cloudflare-initiated change (rare) |

**Security note:** If you see `actor.type = user` and `interface = API` at 3am from an IP you don't recognize, that's a compromised credential signal. Audit logs enable this detection.

### Integration with Logpush

Cloudflare Logpush can stream audit logs in real-time to:
- Amazon S3 / R2
- Google Cloud Storage
- Azure Blob Storage
- Splunk HEC
- Datadog
- New Relic
- HTTP endpoint (for any SIEM)

Configuration for audit log Logpush:
```bash
# Create Logpush job for audit logs
curl -X POST "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/logpush/jobs" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  --data '{
    "name": "audit-logs-to-s3",
    "logpull_options": "fields=actor.email,actor.ip,action.type,resource.type,when&timestamps=unix",
    "destination_conf": "s3://my-audit-bucket/audit-logs/?region=us-east-1&sse=AES256",
    "dataset": "audit_logs",
    "enabled": true
  }'
```

### Compliance Framework Mapping

| Requirement | Control | How Audit Logs Satisfy It |
|---|---|---|
| **SOC 2 CC7.2** | System monitoring | Evidence that changes are monitored and logged |
| **PCI-DSS 10.2** | Audit log requirements | Individual user access, privileged functions, configuration changes |
| **HIPAA § 164.312(b)** | Audit controls | Logging access to systems containing PHI |
| **ISO 27001 A.12.4** | Logging and monitoring | System administrator activities logged |
| **GDPR Art. 30** | Records of processing | Changes to data processing systems documented |

---

## Dashboard Walkthrough

**Step 1: Access Audit Logs**
1. Account Home → Audit Logs
2. View: latest events, reverse chronological order

**Step 2: Filter Events**
1. Filter by date range: last 7 days
2. Filter by action type: "delete" (shows all deletions)
3. Filter by actor: enter email or user ID
4. Filter by resource: "dns.record" (shows all DNS changes)
5. Filter by zone: `macksportreport.com`

**Step 3: Investigate a Configuration Change**
Scenario: "Someone changed our WAF rule yesterday"
1. Filter: Action Type = update, Resource Type = firewall
2. Filter: Date = yesterday
3. Find the entry
4. Expand: see `oldValue` and `newValue` — exact before/after state
5. Note: `actor.email`, `actor.ip`, `when`

**Step 4: Export Audit Logs**
1. Set your filter criteria
2. Click "Export"
3. Format: JSON or CSV
4. Download the file

**Step 5: Set Up Real-Time Streaming**
1. Account Home → Analytics → Logpush
2. Add new job → Dataset: "Audit Logs"
3. Configure destination (S3, Splunk, R2, etc.)

---

## Hands-On Lab

### Prerequisites
```bash
export CF_ACCOUNT_ID="your-account-id"
export CF_API_TOKEN="your-api-token"
```

### Lab 1: Retrieve Audit Logs via API
```bash
# Last 100 audit events
curl "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/audit_logs?per_page=100" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" | python3 -m json.tool | head -100
```

### Lab 2: Filter to Delete Actions
```bash
# Find all delete actions in last 7 days
since=$(date -u -v-7d +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '7 days ago' +%Y-%m-%dT%H:%M:%SZ)

curl "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/audit_logs?action.type=delete&since=${since}&per_page=100" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" | python3 -c "
import json, sys
data = json.load(sys.stdin)
for log in data.get('result', []):
    action = log.get('action', {})
    actor = log.get('actor', {})
    resource = log.get('resource', {})
    print(f\"{log.get('when', 'N/A')} | {actor.get('email', 'N/A')} | {action.get('type', 'N/A')} | {resource.get('type', 'N/A')}\")
"
```

### Lab 3: Find DNS Changes
```bash
curl "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/audit_logs?resource.type=dns_record&per_page=50" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" | python3 -c "
import json, sys
data = json.load(sys.stdin)
for log in data.get('result', []):
    print(json.dumps({
        'when': log.get('when'),
        'actor': log.get('actor', {}).get('email'),
        'action': log.get('action', {}).get('type'),
        'resource_id': log.get('resource', {}).get('id'),
        'zone': log.get('metadata', {}).get('zone_name')
    }, indent=2))
"
```

### Lab 4: Find API vs Dashboard Changes
```bash
# Find changes made via API (not dashboard)
curl "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/audit_logs?per_page=100" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" | python3 -c "
import json, sys
data = json.load(sys.stdin)
api_changes = [log for log in data.get('result', []) if log.get('interface') == 'API']
print(f'API changes found: {len(api_changes)}')
for log in api_changes[:10]:
    print(f\"  {log.get('when')} | {log.get('actor', {}).get('email')} | {log.get('action', {}).get('type')} | {log.get('resource', {}).get('type')}\")
"
```

### Lab 5: Find Changes by a Specific User
```bash
USER_EMAIL="admin@macksportreport.com"

curl "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/audit_logs?actor.email=${USER_EMAIL}&per_page=100" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" | python3 -c "
import json, sys
data = json.load(sys.stdin)
print(f'Changes by {\"${USER_EMAIL}\"}: {len(data.get(\"result\", []))}')
for log in data.get('result', [])[:20]:
    print(f\"  {log.get('when')} | {log.get('action', {}).get('type')} | {log.get('resource', {}).get('type')}\")
"
```

### Lab 6: Incident Investigation Workflow
```bash
# Scenario: A WAF rule was deleted and traffic that was blocked is now getting through
# Step 1: Find recent deletions
since=$(date -u -v-24h +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '24 hours ago' +%Y-%m-%dT%H:%M:%SZ)

curl "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/audit_logs?action.type=delete&since=${since}&per_page=50" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" | python3 -c "
import json, sys
data = json.load(sys.stdin)
firewall_deletes = [
    log for log in data.get('result', [])
    if 'firewall' in log.get('resource', {}).get('type', '').lower()
    or 'waf' in log.get('resource', {}).get('type', '').lower()
]
print(f'Firewall/WAF deletions in last 24h: {len(firewall_deletes)}')
for log in firewall_deletes:
    print(json.dumps({
        'when': log.get('when'),
        'actor': log.get('actor', {}),
        'deleted_resource': log.get('resource'),
        'old_value': log.get('oldValue')
    }, indent=2))
"
```

---

## Demo Script (2 Minutes)

**Audience:** CISO or compliance officer doing a SOC 2 or PCI audit review

**Opening (15 seconds):**
"Your SOC 2 auditor is going to ask: 'Show me every change made to your production web security rules in the last 6 months, and who made each change.' Do you have that answer today?"

**Act 1 — Show the audit log (40 seconds):**
"[Navigate to Audit Logs.] This is every change to your Cloudflare configuration — DNS, WAF, CDN, Workers, Access policies. Who, what, when, and from what IP. [Click a WAF rule deletion.] Here's the change: on November 14th, this user deleted this rule. Old value: [show JSON]. New value: null. You can see exactly what was removed and by whom."

**Act 2 — Show filtering for compliance (30 seconds):**
"For your auditor: filter by resource type 'firewall' and action type 'delete', date range 6 months. Export to JSON. This is your PCI-DSS 10.2 evidence for firewall rule changes. Same for DNS changes, user provisioning, everything in this system."

**Act 3 — Show streaming (20 seconds):**
"And if you need longer than 6 months for your audit trail, or you need it in your SIEM, Logpush streams this to your S3 bucket or Splunk in real-time. Every change flows into your security operations center automatically."

**Close (15 seconds):**
"How are you currently demonstrating to auditors that changes to your web security platform are authorized and logged? If the answer involves spreadsheets, this is a better story."

---

## Competitive Context

| Feature | Cloudflare Audit Logs | AWS CloudTrail | Azure Activity Log | GCP Cloud Audit Logs | Manual change logs |
|---|---|---|---|---|---|
| **CF-specific events** | Yes (all CF actions) | No (AWS only) | No (Azure only) | No (GCP only) | Whatever you document |
| **API + UI changes** | Yes (unified) | Yes (API) | Yes | Yes | Manual |
| **Old/new values** | Yes (for many resource types) | Partial | Partial | Partial | Depends |
| **Retention** | 6 months (built-in) | 90 days (configurable, paid) | 90 days | 400 days (Data Access) | Indefinite (manual) |
| **Export/SIEM streaming** | Logpush (real-time) | S3 / CloudWatch | Event Hubs / Log Analytics | BigQuery / Pub/Sub | Manual |
| **Cost** | Free | Free for management events | Free (basic) | Free (admin) | Staff time |
| **API access** | Yes | Yes | Yes | Yes | N/A |
| **Compliance mapping** | General | AWS compliance programs | Azure compliance | GCP compliance | Manual mapping |

---

## Self-Check Questions

**Question 1:** A WAF rule blocking SQL injection attacks was deleted last Tuesday. Using Audit Logs, walk through the exact steps to identify who deleted it and what the rule looked like before deletion.

```
Your answer:




```

**Question 2:** What is the difference between Audit Logs and Cloudflare Firewall Events? Give an example of something that appears in each but NOT in the other.

```
Your answer:




```

**Question 3:** A compliance auditor requires 24 months of audit logs. Cloudflare retains 6 months. What is the recommended architecture to meet this requirement?

```
Your answer:




```

**Question 4:** You notice an unusual `actor.type = user` event in Audit Logs at 2am from an IP in a country where you have no employees. What are the next three steps in your incident response?

```
Your answer:




```

**Question 5:** What information can you get from `oldValue` and `newValue` fields in an audit log entry? What types of changes might not have these fields populated?

```
Your answer:




```

---

## Sources

- [Cloudflare Audit Logs Documentation](https://developers.cloudflare.com/fundamentals/account-and-billing/account-security/review-audit-logs/)
- [Audit Logs API Reference](https://developers.cloudflare.com/api/operations/audit-logs-get-account-audit-logs)
- [Logpush for Audit Logs](https://developers.cloudflare.com/logs/reference/log-fields/account/audit_logs/)
- [Logpush Setup](https://developers.cloudflare.com/logs/get-started/enable-destinations/)
- [SOC 2 Requirements for Change Management](https://www.aicpa.org/resources/article/soc-2-introduction-and-criteria)
- [PCI-DSS Requirement 10 (Logging)](https://www.pcisecuritystandards.org/document_library/)
- [NIST 800-53 AU Controls (Audit and Accountability)](https://csrc.nist.gov/publications/detail/sp/800-53/rev-5/final)
