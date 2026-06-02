# Module 6.7 — Cloud Connector
> **Dashboard Location:** macksportreport.com → Rules → Cloud Connector
> **Estimated Time:** 50 minutes
> **Lab Domain:** macksportreport.com

---

## Theory (SE-Level)

### What Is Cloud Connector?

Cloud Connector is a no-code integration that lets Cloudflare route matched requests directly to cloud object storage — AWS S3, Google Cloud Storage (GCS), Azure Blob Storage, or Cloudflare R2 — without any origin server.

Instead of writing a Worker to proxy S3 requests, or managing a CORS configuration on your bucket, or maintaining an NGINX reverse proxy that fronts your storage bucket, you configure a Cloud Connector rule: "when path starts with `/assets/`, serve from this S3 bucket." Cloudflare handles the request routing, authentication to the cloud bucket, caching, and security — automatically.

### Why This Matters for Sales

Cloud Connector eliminates an entire class of origin infrastructure for static content. For a customer serving images, videos, PDFs, or any static files from a cloud bucket, the traditional approach looks like:

```
User → CloudFront (CDN) → S3 Bucket
```
(Paying for CDN compute AND S3 storage AND data transfer)

With Cloud Connector:
```
User → Cloudflare (CDN + WAF + Security) → S3/R2/GCS/Azure
```

One CDN layer. Cloudflare's full security stack applied to static assets. No separate CDN contract with each cloud provider.

### Supported Cloud Providers

| Provider | Storage Product | Notes |
|---|---|---|
| **AWS** | S3 (Simple Storage Service) | Public and private buckets |
| **Google Cloud** | Cloud Storage (GCS) | Bucket-level integration |
| **Microsoft Azure** | Blob Storage | Container-level integration |
| **Cloudflare** | R2 | Native — zero egress costs |

---

## Deep Dive (Architect-Level)

### How Cloud Connector Works Internally

When Cloud Connector fires for a request, Cloudflare:

1. Matches the request against your rule condition (path prefix, etc.)
2. Authenticates to the target cloud storage provider using stored credentials/keys
3. Transforms the request URL to the cloud storage URL format
4. Fetches the object from cloud storage
5. Returns the response through Cloudflare's full stack (WAF checked, cache applied, security headers added)

The user never knows they're getting content from S3 or GCS — they see your domain.

### Authentication Model Per Provider

#### AWS S3

Cloud Connector supports both public S3 buckets and private S3 buckets (using AWS IAM credentials):

**Public bucket:** No credentials needed. The bucket must have public read ACL or a bucket policy allowing public access.

**Private bucket:** You store AWS credentials in Cloudflare. Cloud Connector signs requests with AWS Signature Version 4 (SigV4). The IAM policy for the user/role should be scoped to `s3:GetObject` on the specific bucket:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::macksportreport-assets/*"
    }
  ]
}
```

#### Google Cloud Storage

GCS integration uses a service account with `Storage Object Viewer` role on the target bucket. You provide the service account JSON key to Cloudflare.

#### Azure Blob Storage

Azure integration uses a Shared Access Signature (SAS) or storage account key. Scope the SAS to read-only access on the specific container.

#### Cloudflare R2

R2 integration is native — no external authentication needed. If your zone is in the same Cloudflare account as the R2 bucket, Cloud Connector connects directly via internal routing with no egress charges.

### The R2 Advantage: Zero Egress

This is a strong selling point versus S3 + CloudFront:

**AWS S3 + CloudFront:**
- S3 storage: $0.023/GB/month
- S3 → CloudFront: $0.008/GB (data transfer out)
- CloudFront distribution: $0.0075/10,000 requests

**Cloudflare R2 + Cloud Connector:**
- R2 storage: $0.015/GB/month
- R2 → Cloudflare: $0 (zero egress)
- Cloudflare requests: included in plan

For a customer serving 10TB/month of media:
- AWS approach: ~$80 in data transfer out to CloudFront
- R2 approach: $0 in data transfer
- Over a year: ~$960 saved just on egress

### Path Mapping and URL Translation

Cloud Connector maps request paths to bucket object keys. The mapping depends on how you configure the rule:

**Example configuration:**
- Match condition: `starts_with(http.request.uri.path, "/sports-images/")`
- Destination: `macksportreport-media.s3.amazonaws.com`

**Request arrives:** `GET https://macksportreport.com/sports-images/nfl/logos/chiefs.png`

**Cloud Connector translates to:** `GET https://macksportreport-media.s3.amazonaws.com/sports-images/nfl/logos/chiefs.png`

The full path is preserved and appended to the bucket URL. Objects in S3 must be stored at the same path structure.

**Alternative — strip prefix:** If your objects in S3 don't include the `/sports-images/` prefix (they're stored at `/nfl/logos/chiefs.png`), you'd need either:
1. A URL Rewrite Transform Rule to strip the prefix before Cloud Connector fires
2. Or match on a path prefix that already matches the S3 key structure

### Caching Behavior

Objects served via Cloud Connector are cacheable through Cloudflare's edge cache. The cache behavior follows:
- Origin (cloud storage) Cache-Control headers are respected
- Cache Rules you configure apply on top — so you can override TTLs, force cache-everything, etc.
- Static assets (images, videos, JS, CSS) from cloud storage typically benefit from long cache TTLs

### Security: WAF and Bot Protection on Static Assets

A key advantage over direct cloud bucket hosting: when requests come through Cloud Connector, they pass through Cloudflare's full security stack:
- WAF rules apply
- Bot Management applies
- DDoS protection applies
- Rate limiting applies
- IP intelligence applies

A direct S3 bucket URL has none of this — hotlink protection at best, no real security. Cloud Connector brings enterprise security to static asset delivery.

### Cloud Connector vs Workers R2 Bindings

| Feature | Cloud Connector | Workers R2 Binding |
|---|---|---|
| **Code required** | No — dashboard config | Yes — JavaScript |
| **External storage providers** | S3, GCS, Azure, R2 | R2 only |
| **Custom logic** | No | Full JavaScript |
| **Transformations** | Via separate Transform Rules | Inline in Worker |
| **Authentication handling** | Automatic | Manual (for R2, binding handles it) |
| **Cost** | Included in plan | Workers pricing |
| **Use case** | Simple "serve from bucket" | Complex logic (auth, transforms, conditional fetching) |

### Terraform

At time of writing, Cloud Connector configuration is primarily done via dashboard or API. Terraform support is available via the `cloudflare_ruleset` resource using the appropriate phase and action.

---

## Dashboard Walkthrough

### Step 1: Navigate to Cloud Connector
1. macksportreport.com → **Rules** → **Cloud Connector**
2. Overview shows available cloud providers as cards

### Step 2: Configure an S3 Connection

#### Option A — Public S3 Bucket
1. Click **Amazon S3**
2. Rule name: "Sports Images from S3"
3. Match condition: `starts_with(http.request.uri.path, "/images/")`
4. Bucket hostname: `macksportreport-media.s3.us-east-1.amazonaws.com`
5. Authentication: **Public** (no credentials needed)
6. **Save**

#### Option B — Private S3 Bucket
1. Same steps, but select **Private (AWS credentials)**
2. Enter:
   - AWS Access Key ID
   - AWS Secret Access Key
   - AWS Region: `us-east-1`
3. Cloudflare stores these credentials encrypted and uses them to sign requests

### Step 3: Configure an R2 Connection
1. Click **Cloudflare R2**
2. Select the bucket from dropdown (buckets in same account auto-populate)
3. Match condition: `starts_with(http.request.uri.path, "/media/")`
4. **Save**

### Step 4: Test the Cloud Connector
1. Upload a test file to your S3 bucket at path `/images/test.jpg`
2. Request `https://macksportreport.com/images/test.jpg`
3. Should return the image from S3 through Cloudflare

---

## Hands-On Lab

### Prerequisites
- AWS account with an S3 bucket containing test objects
- Objects must be publicly accessible (for this lab) OR you have IAM credentials

```bash
export CF_API_TOKEN="your_api_token"
export ZONE_ID="your_zone_id"
export S3_BUCKET_HOSTNAME="macksportreport-media.s3.amazonaws.com"
```

### Lab 1: Create a Test S3 Bucket (If Needed)

```bash
# Create a test S3 bucket (replace with your preferred region)
aws s3 mb s3://macksportreport-cloudconnector-test --region us-east-1

# Upload a test file
echo "<h1>Hello from S3 via Cloud Connector!</h1>" > /tmp/test.html
aws s3 cp /tmp/test.html s3://macksportreport-cloudconnector-test/test/hello.html

# Make the object publicly accessible
aws s3api put-bucket-policy \
  --bucket macksportreport-cloudconnector-test \
  --policy '{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Sid": "PublicRead",
        "Effect": "Allow",
        "Principal": "*",
        "Action": "s3:GetObject",
        "Resource": "arn:aws:s3:::macksportreport-cloudconnector-test/*"
      }
    ]
  }'

echo "Bucket and test file ready"
```

### Lab 2: Verify Direct S3 Access (Baseline)

```bash
# Confirm the file is accessible directly from S3 (without Cloudflare)
curl -s -I "https://macksportreport-cloudconnector-test.s3.amazonaws.com/test/hello.html"
# Should return 200

# Note the headers — S3's own headers, no Cloudflare security headers
```

### Lab 3: Create Cloud Connector via API

```bash
# Cloud Connector creates a rule in http_request_origin phase
# First, get or create the ruleset for that phase
RULESET_ID=$(curl -s -X GET \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/rulesets" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" | \
  jq -r '.result[] | select(.phase == "http_request_origin") | .id')

# Create the Cloud Connector rule
curl -s -X POST \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/rulesets/${RULESET_ID}/rules" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "route",
    "action_parameters": {
      "origin": {
        "host": "macksportreport-cloudconnector-test.s3.amazonaws.com"
      },
      "host_header": "macksportreport-cloudconnector-test.s3.amazonaws.com"
    },
    "expression": "starts_with(http.request.uri.path, \"/s3test/\")",
    "description": "Lab: Cloud Connector to S3",
    "enabled": true
  }' | jq '{id: .result.id, action: .result.action}'
```

### Lab 4: Test via Cloudflare

```bash
# Test that requests to /s3test/* are served from S3 through Cloudflare
curl -s -I "https://macksportreport.com/s3test/test/hello.html"

# Check headers:
# - Should include CF-RAY (confirms it went through Cloudflare)
# - Should include any security headers you've added via Transform Rules
# - Content-Type should be text/html
```

### Lab 5: Confirm WAF Is Active

```bash
# Attempt a path traversal on the cloud connector path
# WAF should block this even though destination is S3
curl -s -o /dev/null -w "%{http_code}" \
  "https://macksportreport.com/s3test/../../../etc/passwd"
# Should return 403 (blocked by WAF)
```

### Lab 6: Cleanup

```bash
# Remove the test S3 objects and bucket
aws s3 rm s3://macksportreport-cloudconnector-test --recursive
aws s3 rb s3://macksportreport-cloudconnector-test

# Remove the Cloudflare rule you created
RULE_ID="your_rule_id_from_lab_3"
curl -s -X DELETE \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/rulesets/${RULESET_ID}/rules/${RULE_ID}" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" | jq '.success'
```

---

## Demo Script (2 Minutes)

**Audience:** Startup engineering lead serving media from S3 + CloudFront, looking to consolidate

---

*"Right now you've got S3 for storage and CloudFront for CDN. Two billing accounts, two configurations, two places to debug when something breaks. And you're paying CloudFront's egress rates on top of S3 storage."*

[Navigate to Rules → Cloud Connector]

*"Cloud Connector removes the CloudFront layer entirely. I set up one rule: 'requests matching `/images/*` → route to your S3 bucket.' Cloudflare handles the SigV4 authentication to S3, caches the objects at our 300+ PoPs, and runs your WAF and bot protection on top."*

[Show the AWS authentication form]

*"You give us a read-only IAM credential scoped to just that bucket — `s3:GetObject` on the bucket ARN. We sign every request with AWS Signature v4. Your bucket can stay private. No public bucket, no bucket policy change."*

*"But the real story for you is R2. If you migrate your media from S3 to Cloudflare R2 — same 15 dollars per TB per month for storage — your egress cost goes from 8 cents per GB to zero. For a team serving 10TB/month, that's almost a thousand dollars a year. Cloud Connector plus R2 is literally a cost decision."*

---

## Competitive Context

| Feature | Cloudflare Cloud Connector | AWS S3 + CloudFront | Azure CDN + Blob Storage | Fastly + GCS |
|---|---|---|---|---|
| **No-code setup** | Yes — dashboard | No — separate CloudFront dist config | No — CDN profile config | No — Fastly VCL |
| **Multi-cloud support** | S3, GCS, Azure, R2 | S3 only | Azure Blob only | GCS preferred |
| **Auth to bucket** | Automatic SigV4/service account | Built into CloudFront Origin | Built into Azure CDN | Manual Fastly config |
| **WAF on static assets** | Yes — full Cloudflare WAF | Yes — AWS WAF add-on | Yes — Azure WAF add-on | Yes — Signal Sciences add-on |
| **Egress cost** | R2: $0 / S3: S3 rates | CloudFront: $0.0085/GB | Azure CDN: variable | Fastly: billed separately |
| **Unified rules for static+dynamic** | Yes — same Rules Engine | No — separate systems | No | No |
| **One control plane** | Yes | No — S3 + CloudFront + WAF separate | No | No |

---

## Self-Check Questions

**Question 1:** A customer wants to serve private S3 objects (not publicly accessible) through Cloudflare using Cloud Connector. What do they need to configure in AWS IAM, and what do they provide to Cloudflare?

```
Your answer:
_______________________________________________
_______________________________________________
_______________________________________________
```

**Question 2:** A customer has objects stored in S3 at path `/media/2024/sports/nfl/scores.json` but their Cloudflare URL should be `/api/scores/nfl`. How would you map this URL to the S3 object path? What Cloudflare feature do you combine with Cloud Connector?

```
Your answer:
_______________________________________________
_______________________________________________
_______________________________________________
```

**Question 3:** Explain the egress cost difference between "S3 + CloudFront + Cloud Connector" (routing through Cloudflare to S3) vs "R2 + Cloud Connector". Why does R2 have a different cost profile?

```
Your answer:
_______________________________________________
_______________________________________________
_______________________________________________
```

**Question 4:** A customer is worried that serving their S3 content via Cloud Connector means Cloudflare stores their credentials. How should you address this security concern?

```
Your answer:
_______________________________________________
_______________________________________________
_______________________________________________
```

**Question 5:** Can Cloud Connector be combined with Cache Rules? Describe how you would set up aggressive edge caching for objects served via Cloud Connector from S3.

```
Your answer:
_______________________________________________
_______________________________________________
_______________________________________________
```

---

## Sources

- [Cloud Connector Documentation](https://developers.cloudflare.com/rules/cloud-connector/)
- [Cloud Connector — AWS S3](https://developers.cloudflare.com/rules/cloud-connector/providers/aws-s3/)
- [Cloud Connector — Google Cloud Storage](https://developers.cloudflare.com/rules/cloud-connector/providers/google-cloud-storage/)
- [Cloud Connector — Azure Blob Storage](https://developers.cloudflare.com/rules/cloud-connector/providers/azure-blob-storage/)
- [Cloudflare R2 Documentation](https://developers.cloudflare.com/r2/)
- [R2 Pricing — Zero Egress](https://developers.cloudflare.com/r2/pricing/)
- [Cache Rules Documentation](https://developers.cloudflare.com/cache/how-to/cache-rules/)
