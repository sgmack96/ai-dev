# Module 13.2 — Notifications & Alerts
> Dashboard Location: Account Home → Notifications | Estimated Time: 45 min | Lab Domain: macksportreport.com

---

## Theory (SE-Level)

Cloudflare Notifications is the alerting system that sends you notifications when significant events happen across any Cloudflare product. Instead of watching dashboards manually, you configure policies that trigger alerts and deliver them to email, webhooks, PagerDuty, or other integrations.

**Why this matters operationally:** A DDoS attack starts at 2am. Your origin goes down at 3pm on a Friday. An SSL certificate is about to expire. Your Workers error rate spikes. Without notifications, you find out from a customer tweet or a missed SLA. With notifications, you (or your on-call engineer) know within minutes.

**Categories of notifications:**
- **Security events:** DDoS attack detected, WAF rule threshold exceeded, SSL certificate issues
- **Performance events:** Health check failure, load balancer failover, origin connectivity problem
- **Product events:** Workers error rate spike, Tunnel connection lost, Rate limit threshold hit
- **Account events:** User login from new location, API token used from new IP
- **Network events (Enterprise):** BGP hijack detected, Magic Transit traffic anomaly

**Delivery channels:**
- Email (any email address)
- Webhook (HTTP POST to any endpoint)
- PagerDuty (direct integration)
- Splunk On-Call (direct integration)
- Jira (Enterprise — create tickets automatically)
- Microsoft Teams (via webhook)
- Slack (via webhook)

---

## Deep Dive (Architect-Level)

### Alert Policy Architecture

Each notification is configured as a "policy":
- **Alert type:** What event triggers it (DDoS started, Health check failed, etc.)
- **Conditions:** Additional filtering (specific zone, threshold value, duration)
- **Delivery method:** Email, webhook, PagerDuty, etc.
- **Enabled/disabled:** Toggle without deleting

Policies are independent — you can have multiple policies for the same alert type with different delivery methods (e.g., DDoS started → email to team + PagerDuty for on-call).

### Webhook Payload Structure

When a webhook fires, Cloudflare sends an HTTP POST to your configured URL with a JSON payload:

```json
{
  "text": "A DDoS attack has been detected for zone macksportreport.com",
  "data": {
    "zone_name": "macksportreport.com",
    "zone_id": "abc123def456",
    "attack_id": "attack-uuid",
    "attack_type": "volumetric",
    "start_time": "2024-11-15T02:45:00Z",
    "estimated_impact": {
      "requests_per_second": 125000,
      "bytes_per_second": 89000000
    }
  },
  "alert_type": "dos_attack_l7",
  "id": "notification-uuid",
  "name": "DDoS Attack Alert",
  "policy_id": "policy-uuid",
  "source": "cloudflare",
  "timestamp": "2024-11-15T02:45:30Z"
}
```

The webhook format is consistent but `data` fields vary by alert type.

### Full Alert Type Reference

| Alert Type | Trigger | Notes |
|---|---|---|
| `dos_attack_l7` | HTTP DDoS attack detected | Starts and ends separately |
| `dos_attack_l4` | L3/L4 DDoS attack (Magic Transit) | Enterprise |
| `advanced_ddos_attack_l7` | Anomaly-based DDoS detection | Enterprise |
| `ssl_certificate_issuance_failed` | SSL cert failed to provision | Action required |
| `ssl_certificate_renewal_7_days` | Cert expires in 7 days | Warning |
| `ssl_certificate_renewal_30_days` | Cert expires in 30 days | Heads up |
| `health_check_status_notification` | Health check changed status | Failover triggered |
| `load_balancing_pool_enablement_alert` | LB pool disabled/enabled | Failover event |
| `scriptmonitor_alert_new_scripts_seen` | New JS script on your pages | Shadow IT detection |
| `workers_alert` | Workers error rate threshold | Performance degradation |
| `tunnel_health_event` | Cloudflare Tunnel went down/up | Connectivity alert |
| `billing_usage_alert` | Usage approaching billing limit | Cost control |
| `secondary_dns_zone_transfer_alert` | DNS zone transfer failed/succeeded | DNS operations |
| `bgp_hijack_notification` | BGP route hijack detected | Enterprise, security |
| `magic_transit_health_check_event` | Magic Transit tunnel status | Enterprise |

### Threshold-Based Alerts

Some alerts fire based on thresholds you configure:
- **Workers error rate:** Fire when error rate exceeds X% over Y minutes
- **Health checks:** Fire after N consecutive failures
- **Rate limit:** Fire when N requests blocked per minute
- **Billing:** Fire when spend reaches X% of budget

Configure thresholds to match your SLA requirements — high-traffic sites might accept 2% error rate without alert; low-traffic critical systems might alert at 0.1%.

### Alert Fatigue Mitigation

Best practices to avoid alert fatigue:
1. **Separate channels by severity:** DDoS → PagerDuty (wake someone up); cert renewal 30 days → email (not urgent)
2. **Use test notifications** before relying on a policy in production
3. **Review and prune:** Audit notification policies quarterly; remove stale policies
4. **Deduplicate at receiver:** If using Slack, configure alert deduplication to prevent spam during extended incidents

---

## Dashboard Walkthrough

**Step 1: Navigate to Notifications**
1. Account Home → Notifications
2. Overview: all configured notification policies

**Step 2: Create a DDoS Alert**
1. Click "Add"
2. Alert type: Search "DDoS" → select "HTTP DDoS Attack Alert"
3. Alert name: `DDoS Attack - macksportreport.com`
4. Zones to monitor: `macksportreport.com`
5. Delivery method: Email → your-email@company.com
6. Click "Create"

**Step 3: Add a Webhook Delivery Method**
1. Account Home → Notifications → Destinations
2. Click "Add destination" → Webhook
3. Name: `Slack - Security Channel`
4. URL: your Slack webhook URL
5. Test the webhook

**Step 4: Create a Health Check Alert**
1. Add → Alert type: "Health Check Status Notification"
2. Name: `Origin Health Check Alert`
3. Zone: macksportreport.com
4. Delivery: Email + webhook
5. Save

**Step 5: Create an SSL Expiry Alert**
1. Add → Alert type: "SSL/TLS Certificate Alert"
2. Select: "Universal SSL Certificate Alert (Renewal)"
3. Threshold: 30 days before expiry
4. Delivery: Email
5. Save second policy for 7 days

**Step 6: Test a Notification**
1. Click on a configured policy
2. Click "Test notification"
3. Verify delivery at the configured destination

---

## Hands-On Lab

### Prerequisites
```bash
export CF_ACCOUNT_ID="your-account-id"
export CF_API_TOKEN="your-api-token"

# For webhook testing, you can use https://webhook.site to get a test endpoint
export WEBHOOK_URL="https://webhook.site/your-unique-id"
```

### Lab 1: List All Notification Policies
```bash
curl "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/alerting/v3/policies" \
  -H "Authorization: Bearer ${CF_API_TOKEN}"
```

### Lab 2: Create a Webhook Destination
```bash
curl -X POST "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/alerting/v3/destinations/webhooks" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{
    "name": "Webhook Site Test",
    "url": "'"${WEBHOOK_URL}"'"
  }'
# Note the webhook ID from response
```

### Lab 3: Create a DDoS Notification Policy
```bash
WEBHOOK_ID="webhook-id-from-lab-2"
ZONE_ID="your-zone-id"

curl -X POST "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/alerting/v3/policies" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{
    "name": "DDoS Attack Alert - macksportreport.com",
    "alert_type": "dos_attack_l7",
    "description": "Alert when HTTP DDoS attack is detected",
    "enabled": true,
    "filters": {
      "zones": ["'"${ZONE_ID}"'"]
    },
    "mechanisms": {
      "webhooks": [{"id": "'"${WEBHOOK_ID}"'"}]
    }
  }'
```

### Lab 4: Create SSL Certificate Expiry Alerts
```bash
ZONE_ID="your-zone-id"

# 30-day warning
curl -X POST "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/alerting/v3/policies" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{
    "name": "SSL Expiry Warning - 30 Days",
    "alert_type": "ssl_certificate_renewal_30_days",
    "description": "SSL certificate expiring within 30 days",
    "enabled": true,
    "filters": {
      "zones": ["'"${ZONE_ID}"'"]
    },
    "mechanisms": {
      "webhooks": [{"id": "'"${WEBHOOK_ID}"'"}]
    }
  }'

# 7-day critical alert
curl -X POST "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/alerting/v3/policies" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{
    "name": "SSL Expiry CRITICAL - 7 Days",
    "alert_type": "ssl_certificate_renewal_7_days",
    "description": "SSL certificate expiring within 7 days - ACTION REQUIRED",
    "enabled": true,
    "mechanisms": {
      "webhooks": [{"id": "'"${WEBHOOK_ID}"'"}]
    }
  }'
```

### Lab 5: Create a Slack Webhook Integration
```bash
# First create a Slack app and get incoming webhook URL
# https://api.slack.com/apps → Create App → Incoming Webhooks

SLACK_URL="https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK"

# Create Cloudflare webhook destination pointing to Slack
curl -X POST "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/alerting/v3/destinations/webhooks" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{
    "name": "Slack - Security Alerts Channel",
    "url": "'"${SLACK_URL}"'",
    "secret": "optional-signing-secret"
  }'
```

### Lab 6: Test a Notification Policy
```bash
POLICY_ID="policy-id-from-lab-3"

curl -X POST "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/alerting/v3/policies/${POLICY_ID}/test" \
  -H "Authorization: Bearer ${CF_API_TOKEN}"

# Verify the test notification arrived at your webhook.site or Slack channel
```

### Lab 7: Create a Workers Error Rate Alert
```bash
curl -X POST "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/alerting/v3/policies" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{
    "name": "Workers Error Rate Alert",
    "alert_type": "workers_alert",
    "description": "Workers error rate above threshold",
    "enabled": true,
    "filters": {
      "enabled": ["true"]
    },
    "mechanisms": {
      "webhooks": [{"id": "'"${WEBHOOK_ID}"'"}]
    }
  }'
```

---

## Demo Script (2 Minutes)

**Audience:** Developer or SRE responsible for uptime

**Opening (15 seconds):**
"When something breaks on your Cloudflare-protected site — DDoS attack, cert expiring, health check failure — how do you find out? Support ticket from a customer? Monitoring tool that checks every 5 minutes?"

**Act 1 — Show the alert types (30 seconds):**
"[Navigate to Notifications → Add.] Cloudflare can alert you for all of this: DDoS attacks the second they start. SSL certificates expiring 30 days out. Health check failures triggering load balancer failover. Tunnel going down. Workers error rate spiking. Every major event in the platform has a corresponding alert type."

**Act 2 — Show delivery channels (30 seconds):**
"And you choose where it goes. Email for low-urgency — cert renewal 30 days out. PagerDuty for anything that wakes someone up — DDoS attack, origin down. Slack for the team channel so everyone sees it. Webhook for your internal tooling. [Show webhook destination creation.] It's a POST to any URL you provide."

**Act 3 — Show testing (20 seconds):**
"[Click Test notification.] You don't have to wait for an attack to test this. Click 'Test' on any policy and you get a real test payload at your destination. Verify the integration works before you need it at 2am."

**Close (15 seconds):**
"Setting up five baseline notification policies takes 10 minutes. What do you want to know about first: attacks, cert issues, or origin health?"

---

## Competitive Context

| Feature | Cloudflare Notifications | Datadog Monitors | PagerDuty with webhooks | OpsGenie | Custom monitoring |
|---|---|---|---|---|---|
| **CF-native events** | Yes (all CF products) | Via webhook + parsing | Via CF webhook | Via CF webhook | Via CF webhook + build |
| **Setup complexity** | Low (built into dashboard) | Medium (query language) | Medium (integration) | Medium | High |
| **Alert types** | 30+ CF-specific types | Generic metrics | Generic | Generic | Whatever you build |
| **Delivery channels** | Email, webhook, PD, Splunk | Email, PD, Slack, etc. | All major channels | All major channels | Whatever you code |
| **Test functionality** | Yes (built-in) | Yes | Manual | Yes | Manual |
| **Cost** | Free | $15+/host/month | $21+/user/month | $9+/user/month | Dev time + infra |
| **Integration with incidents** | Jira (Enterprise) | Incident management | Primary use case | Incident management | Custom |
| **Historical alert log** | Limited | Yes | Yes | Yes | Depends |
| **API access** | Yes | Yes | Yes | Yes | N/A |

**Key positioning:** Cloudflare Notifications are purpose-built for CF events. Datadog and PagerDuty are generic monitoring platforms — you CAN route CF events there via webhook, but you're building the integration yourself. CF Notifications have zero setup for CF-specific alerts: attack started, cert expiring, health check failed. These are the events you care about most.

---

## Self-Check Questions

**Question 1:** A security-conscious customer wants to be notified the moment a DDoS attack is detected on their zone, and wants their on-call engineer paged via PagerDuty. Describe the exact notification policy configuration.

```
Your answer:




```

**Question 2:** Explain the difference between the 30-day SSL certificate renewal alert and the 7-day alert. How would you configure them with different urgency levels in a practical setup?

```
Your answer:




```

**Question 3:** A customer wants to send Cloudflare alerts to their Slack channel. Cloudflare doesn't have a native Slack integration. What is the approach and what are the steps?

```
Your answer:




```

**Question 4:** What is a "test notification" and why is it important to use before relying on a policy in a production incident scenario?

```
Your answer:




```

**Question 5:** A customer has 50 Cloudflare zones and wants DDoS alerts for all of them but doesn't want to create 50 separate policies. How would you configure this?

```
Your answer:




```

---

## Sources

- [Cloudflare Notifications Documentation](https://developers.cloudflare.com/notifications/)
- [Notification Alert Types](https://developers.cloudflare.com/notifications/notification-available/)
- [Notifications API Reference](https://developers.cloudflare.com/api/operations/notification-policies-list-notification-policies)
- [Webhook Destinations](https://developers.cloudflare.com/notifications/get-started/configure-webhooks/)
- [PagerDuty Integration](https://developers.cloudflare.com/notifications/get-started/configure-pagerduty/)
- [Cloudflare Blog: Notifications](https://blog.cloudflare.com/announcing-cloudflare-notifications/)
- [PagerDuty Best Practices for Alert Fatigue](https://www.pagerduty.com/resources/learn/alert-fatigue/)
