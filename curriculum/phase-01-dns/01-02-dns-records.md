# Module 1.2 — DNS Records

> **Dashboard Location:** `macksportreport.com` → DNS → Records  
> **Estimated Time:** 60 minutes  
> **Lab Domain:** macksportreport.com

---

## Theory (SE-Level)

### What DNS Records Do

DNS (Domain Name System) translates human-readable domain names into machine-readable addresses. When someone visits `macksportreport.com`, their browser asks a DNS resolver: "what's the IP address for this?" The resolver asks your authoritative nameserver (Cloudflare), which reads the records you configured and returns an answer.

DNS is the foundation of the internet. Every product in the Cloudflare dashboard depends on DNS being configured correctly first.

### Record Types You Must Know

**A Record (IPv4 Address)**
Maps a hostname to an IPv4 address.
```
Name: macksportreport.com
Type: A
Value: 203.0.113.1  (your origin server IP)
Proxy: ON (orange cloud)
TTL: Auto
```
"A" stands for "Address." Most common record type.

**AAAA Record (IPv6 Address)**
Same as A, but for IPv6.
```
Name: macksportreport.com
Type: AAAA
Value: 2001:db8::1
Proxy: ON
TTL: Auto
```

**CNAME Record (Canonical Name)**
Maps a hostname to another hostname. "This name is an alias for that name."
```
Name: www
Type: CNAME
Value: macksportreport.com
```
Result: `www.macksportreport.com` resolves the same as `macksportreport.com`.

> Important: CNAME records **cannot exist at the apex domain** (e.g., you can't CNAME `macksportreport.com` to `something.example.com`) — this is a DNS protocol limitation. Cloudflare solves this with **CNAME flattening** (covered in Module 1.4).

**MX Record (Mail Exchange)**
Directs email for your domain to a mail server.
```
Name: macksportreport.com
Type: MX
Priority: 10
Value: mail.example.com
```
Lower priority number = higher priority. If you have two MX records, email goes to the lowest number first.

**TXT Record (Text)**
Free-form text, used for verification and authentication.
```
Name: macksportreport.com
Type: TXT
Value: "v=spf1 include:_spf.google.com ~all"   ← SPF record
```
Common TXT record uses:
- **SPF** — Which mail servers can send email for your domain
- **DKIM** — Email signing key (`google._domainkey.macksportreport.com`)
- **DMARC** — Email authentication policy (`_dmarc.macksportreport.com`)
- **Domain verification** — Google Search Console, AWS SES, Cloudflare ownership proof

**NS Record (Name Server)**
Delegates a subdomain to a different nameserver. Used for subdomain delegation.
```
Name: subdomain
Type: NS
Value: ns1.otherprovider.com
```
This says: "For anything under `subdomain.macksportreport.com`, ask `ns1.otherprovider.com`."

**SRV Record (Service)**
Specifies location of servers for specific services. Used for SIP, XMPP, some gaming protocols.
```
Name: _sip._tcp.macksportreport.com
Type: SRV
Priority: 10, Weight: 20, Port: 5060
Value: sipserver.example.com
```

**CAA Record (Certification Authority Authorization)**
Restricts which CAs can issue SSL certificates for your domain.
```
Name: macksportreport.com
Type: CAA
Flags: 0
Tag: issue
Value: "letsencrypt.org"
```
Prevents certificate misissuance. If you only use Let's Encrypt, add a CAA record for them.

**PTR Record (Pointer)**
Reverse DNS — maps an IP address back to a hostname. Used for email sending reputation.
Not typically configured in the zone dashboard (it's set on the IP owner's side).

### The Proxy Toggle — Orange Cloud vs Grey Cloud

This is Cloudflare-specific and applies to A, AAAA, and CNAME records:

| State | What Happens |
|-------|-------------|
| **Proxied (orange)** | Traffic flows through Cloudflare. Origin IP is hidden. All CF features apply. |
| **DNS Only (grey)** | Cloudflare returns your real IP. Traffic bypasses Cloudflare. No CF features. |

Rules for when to use each:
- **Always proxy:** Your web server, API server, anything you want protected
- **Never proxy (must be grey):** MX records, mail servers, servers that need to expose real IPs (FTP, SSH, some VPNs), subdomains used for CNAME validation (but not traffic)

### TTL (Time to Live)

TTL is how long DNS resolvers should cache your record before re-querying. Measured in seconds.

| TTL | Use Case |
|-----|----------|
| **Auto (300s when proxied)** | Cloudflare manages it — use this for proxied records |
| **60s** | Active migration, expecting to change soon |
| **300s (5 min)** | Good default for most records |
| **3600s (1 hour)** | Stable records (MX, NS) |
| **86400s (24 hours)** | Very stable records |

> Note: Cloudflare forces TTL to 300s for proxied records regardless of what you set. The TTL you set applies when the record is grey-cloud (DNS Only).

---

## Deep Dive (Architect-Level)

### How DNS Resolution Works (Full Walk-Through)

When a user visits `macksportreport.com`:

1. **Browser cache** — Check if previously resolved (no TTL-based expiry has passed)
2. **OS cache** — Check system's DNS cache
3. **Recursive resolver** — User's ISP or configured resolver (1.1.1.1, 8.8.8.8, etc.) asks on their behalf
4. **Root nameservers** — `.` knows who handles `.com`
5. **TLD nameservers** — `.com` (Verisign) knows which nameservers handle `macksportreport.com` → returns Cloudflare NS records
6. **Cloudflare nameservers** — Return the A record (Cloudflare IP if proxied, origin IP if grey)
7. **Browser connects** — TCP connection to returned IP

Total time: typically 5–300ms depending on caching.

### CNAME Flattening

The DNS RFC says you can't have a CNAME at the apex (root) of a zone because the apex also needs SOA and NS records, and CNAME records are exclusive. This breaks `macksportreport.com` CNAME to `myapp.vercel.app`.

Cloudflare solves this by **flattening** the CNAME at query time:
1. You set `macksportreport.com` CNAME → `myapp.vercel.app`
2. Cloudflare detects it's a CNAME at apex
3. At query time, Cloudflare resolves `myapp.vercel.app` to an IP
4. Cloudflare returns that IP as if it were an A record
5. Works correctly, DNS protocol satisfied

This is enabled by default for apex CNAMEs and is available as a feature toggle for all CNAME records.

### DNSSEC Chain of Trust

DNSSEC adds cryptographic signatures to DNS responses, preventing spoofing. The chain:
```
Root zone (.) → signed
.com TLD → signed, DS record pointing to macksportreport.com's DNSKEY
macksportreport.com → signed by Cloudflare's key
```

The DS (Delegation Signer) record you get from Cloudflare must be added at your registrar. Without it, DNSSEC validation fails. Covered in Module 1.4.

### Wildcard Records

```
Name: *
Type: A
Value: 203.0.113.1
Proxy: ON
```

This matches any subdomain not explicitly defined. `anything.macksportreport.com` resolves to `203.0.113.1`. Useful for SaaS applications where customer subdomains are dynamic.

> Wildcard proxied records have a limitation: they don't get individual SSL certificates per subdomain on free/pro plans. Use Custom Hostnames (Module 2.5) for per-subdomain SSL at scale.

### Record Ordering and Priority

DNS doesn't guarantee record order, but for records with priority (MX, SRV, CAA with `issue`/`issuewild`), lower numbers = higher priority.

---

## Dashboard Walkthrough

### The DNS Records Page (`macksportreport.com → DNS → Records`)

**Table columns:**
- **Type** — Record type (A, AAAA, CNAME, MX, TXT, etc.)
- **Name** — Hostname or subdomain. `@` means the apex domain.
- **Content** — IP address, hostname, or text value
- **Proxy status** — Orange cloud (proxied) or grey cloud (DNS only)
- **TTL** — Time to live. Shows "Auto" when proxied.
- **Actions** — Edit, Delete

**Creating a record:**
1. Click **+ Add record**
2. Select Type
3. Enter Name (`@` for apex, `www` for www subdomain, etc.)
4. Enter Content
5. Toggle proxy on/off
6. Set TTL (leave Auto for proxied)
7. Click Save

**Editing a record:**
Click the pencil icon. Change any field. Save. Changes propagate globally within seconds (Cloudflare updates all edge nodes within ~10 seconds for proxied records).

**Bulk import/export:**
- **Import** — Upload a BIND-format zone file (standard DNS format)
- **Export** — Download your entire zone as a BIND file (good for backup)

**Search and filter:**
Search bar at the top filters records by name or content.

---

## Hands-On Lab

### Lab 1.2: Configure and Verify DNS Records

**Step 1: Audit your current records**
```
dash.cloudflare.com → macksportreport.com → DNS → Records
```
List all records currently configured:

| Type | Name | Content | Proxy |
|------|------|---------|-------|
| | | | |
| | | | |

**Step 2: Verify proxy status is correct**
```bash
# Check what IP users see (should be Cloudflare if proxied)
dig A macksportreport.com +short

# Check if there are any grey-cloud records exposing origin IPs
dig A www.macksportreport.com +short

# These should all be Cloudflare IPs (104.x.x.x, 172.x.x.x)
# If you see your real origin IP, that record is NOT proxied
```

**Step 3: Add an email protection TXT record (SPF)**

If you don't have one, add an SPF record:
```
Type: TXT
Name: @
Content: v=spf1 -all
```
This is a "hard fail" SPF that says no one is authorized to send email for this domain (useful if you don't send email from this domain and want to prevent spoofing).

If you do send email (e.g., via SendGrid, Google Workspace):
```
Content: v=spf1 include:sendgrid.net ~all
```

**Step 4: Add a CNAME for www**

If `www` doesn't exist:
```
Type: CNAME
Name: www
Content: macksportreport.com
Proxy: ON
```

Verify:
```bash
dig CNAME www.macksportreport.com +short
# Should show macksportreport.com. (with period)
# Or after flattening: 104.x.x.x
curl -I https://www.macksportreport.com
# Should return 200 or 301, with cf-ray header
```

**Step 5: Export your zone file**
```
DNS → Records → Export
```
Open the downloaded file. Recognize the BIND format:
```
macksportreport.com 300 IN A 104.x.x.x
www.macksportreport.com 300 IN CNAME macksportreport.com
```
This is the format you'd import when migrating from another DNS provider.

**Step 6: Query all records via API**
```bash
curl -s "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  | jq '.result[] | {type, name, content, proxied, ttl}'
```

---

## Demo Script (2 Minutes)

> Use when explaining DNS to a customer evaluating Cloudflare as their DNS provider

"Our DNS is the fastest authoritative DNS on the internet — that's been independently validated by multiple benchmarks. But speed is just the table stakes. What's really useful is how the DNS management integrates with everything else.

When you create an A record here and flip on the orange cloud, you've just put Cloudflare in front of that hostname. All our security, performance, and caching features activate instantly — no additional config. That orange cloud is what makes everything else in this dashboard work.

There's also a few things we do that standard DNS providers don't. CNAME flattening at the apex — you can point your root domain to Vercel, Netlify, a load balancer hostname — without DNS protocol violations. And every record change propagates globally in under 30 seconds, which matters a lot during incidents when you need to cut over traffic fast."

---

## Competitive Context

| Feature | Cloudflare DNS | Route53 | Namecheap | NS1 |
|---------|---------------|---------|-----------|-----|
| **Query speed (global avg)** | ~11ms | ~40ms | ~80ms | ~20ms |
| **CNAME flattening** | Yes (built-in) | No | No | Yes |
| **DNSSEC** | Yes | Yes | Limited | Yes |
| **Proxy toggle** | Yes (unique) | No | No | No |
| **Price** | Free | $0.50/zone + $0.40/million queries | Free | $100+/month |
| **API** | Full REST API | Full API | Limited | Full API |
| **Terraform** | Full support | Full support | Limited | Full support |
| **Propagation speed** | Seconds (proxied) | 60s+ | Minutes | Seconds |

---

## Self-Check Questions

1. A customer says their email is being spoofed from their domain. Which DNS record types are most relevant to fix this? Name all three.

2. You need to point `app.macksportreport.com` to `myapp.vercel.app` — what record type do you use? Should it be proxied?

3. What happens if you set an MX record with the proxy toggle ON (orange cloud)? Why is this wrong?

4. A customer is migrating from GoDaddy to Cloudflare DNS. Walk through the exact steps, including TTL considerations.

5. What is the difference between TTL "Auto" and TTL "300" for a proxied record?

---

**Your Answers:**

1. 

2. 

3. 

4. 

5. 

---

**Sources:**
- [DNS Records Reference](https://developers.cloudflare.com/dns/manage-dns-records/reference/dns-record-types/)
- [Proxy Status](https://developers.cloudflare.com/dns/manage-dns-records/reference/proxied-dns-records/)
- [CNAME Flattening](https://developers.cloudflare.com/dns/cname-flattening/)
- [TTL](https://developers.cloudflare.com/dns/manage-dns-records/reference/ttl/)
- [Cloudflare DNS Performance](https://www.dnsperf.com/)
- [Import/Export Zone Files](https://developers.cloudflare.com/dns/manage-dns-records/how-to/import-and-export/)
