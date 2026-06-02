# Module 7.1 — Email Routing
> Dashboard Location: macksportreport.com → Email → Email Routing
> Estimated Time: 60 minutes
> Lab Domain: macksportreport.com

---

## Theory (SE-Level)

### What Is Email Routing?

Email Routing lets you receive email at your own domain (e.g., `hello@macksportreport.com`) and forward it to any external address — your Gmail, Outlook, iCloud, or any other inbox — without running an email server.

**The problem it solves:** You own a domain. You want a professional email address (not yourname@gmail.com). You don't want to pay for Google Workspace or manage a mail server. Email Routing is Cloudflare's free answer to that problem.

**What it is NOT:**
- Not a full email hosting service
- Not a sending solution (you can't send from macksportreport.com without a separate service like SendGrid or Mailgun)
- No webmail UI
- No inbox storage

Think of it as a **forwarding layer** — Cloudflare intercepts incoming email at the SMTP level and reroutes it according to your rules.

### How It Works Under the Hood

1. Cloudflare adds **MX (Mail Exchange) records** to your DNS zone, pointing email at Cloudflare's mail infrastructure
2. When a sender sends email to `info@macksportreport.com`, their mail server does an MX lookup and delivers to Cloudflare
3. Cloudflare's email infrastructure receives the SMTP connection
4. Cloudflare evaluates your routing rules (address-based or catch-all)
5. Cloudflare forwards (relays) the email to the destination address
6. The destination server (Gmail, Outlook, etc.) receives the forwarded email

**SPF implication:** Cloudflare adds itself to your SPF record automatically when Email Routing is enabled. This ensures forwarded mail doesn't fail SPF at the destination.

### Routing Rule Types

**Address-Based Rules:**
Match a specific local part (the part before the @).

```
info@macksportreport.com   → youremail@gmail.com
support@macksportreport.com → support-tickets@gmail.com
jobs@macksportreport.com   → hr@gmail.com
```

Up to 200 custom addresses per zone on the free plan.

**Catch-All Rule:**
Match anything that doesn't match a specific rule.

```
*@macksportreport.com → youremail@gmail.com
```

You can set catch-all to: forward, drop (silently discard), or send to a Worker.

**Workers Integration:**
Instead of forwarding to an email address, route to a **Cloudflare Worker** for custom logic. The Worker receives the raw email as an `EmailEvent` object and can:
- Parse headers, body, subject, sender
- Forward conditionally
- Log to KV or D1
- Auto-reply
- Reject the message

### Destination Address Verification

Before Cloudflare will forward to a destination address, that address must be **verified**. Cloudflare sends a verification email to the destination; the owner clicks a link. This prevents using Email Routing to spam arbitrary inboxes.

### Privacy Model

Cloudflare's official position: email content is not retained beyond the time needed to route the message. Cloudflare does not index or store email content. This is distinct from products like Email Security (Area 1) which do analyze content for threats.

---

## Deep Dive (Architect-Level)

### MX Record Configuration

When Email Routing is enabled, Cloudflare automatically configures these MX records:

| Priority | Value |
|----------|-------|
| 17 | route1.mx.cloudflare.net |
| 28 | route2.mx.cloudflare.net |
| 50 | route3.mx.cloudflare.net |

Multiple MX records with different priorities provide redundancy. The sending server tries the lowest priority number first.

### SPF Record Handling

Cloudflare automatically manages the SPF TXT record for your zone:

```
v=spf1 include:_spf.mx.cloudflare.net ~all
```

This includes Cloudflare's sending infrastructure in your SPF policy, which is necessary so forwarded email doesn't trigger SPF failures at the destination.

**Architect consideration:** If you also send email through another provider (e.g., SendGrid, Google Workspace), you must merge their SPF includes into a single record. SPF has a 10-lookup limit; exceeding it causes failures.

```
v=spf1 include:_spf.mx.cloudflare.net include:sendgrid.net include:_spf.google.com ~all
```

### Email Workers — Advanced Processing

Email Workers use a specialized handler that is NOT the standard `fetch` handler:

```javascript
export default {
  async email(message, env, ctx) {
    // message.from — sender address
    // message.to — recipient address
    // message.headers — email headers (Map)
    // message.raw — ReadableStream of raw email bytes
    // message.rawSize — size in bytes

    const subject = message.headers.get("subject");
    const from = message.from;

    // Conditional routing by subject keyword
    if (subject && subject.toLowerCase().includes("urgent")) {
      await message.forward("oncall@gmail.com");
      return;
    }

    // Route sales inquiries separately
    if (from.includes("@enterprise.com")) {
      await message.forward("enterprise-sales@gmail.com");
      return;
    }

    // Log to KV
    const key = `email:${Date.now()}:${from}`;
    await env.EMAIL_LOG.put(key, JSON.stringify({
      from: message.from,
      to: message.to,
      subject: subject,
      timestamp: new Date().toISOString()
    }), { expirationTtl: 86400 * 30 }); // 30 days

    // Default forward
    await message.forward("default@gmail.com");
  }
}
```

**wrangler.toml for Email Worker:**

```toml
name = "email-handler"
main = "src/index.js"
compatibility_date = "2024-09-23"

[[email]]
type = "email"

[[kv_namespaces]]
binding = "EMAIL_LOG"
id = "your-kv-namespace-id"
```

### Auto-Reply Pattern

```javascript
import { EmailMessage } from "cloudflare:email";
import { createMimeMessage } from "mimetext";

export default {
  async email(message, env, ctx) {
    // Build auto-reply
    const msg = createMimeMessage();
    msg.setSender({ name: "Mack's Sport Report", addr: "noreply@macksportreport.com" });
    msg.setRecipient(message.from);
    msg.setSubject("Re: " + message.headers.get("subject"));
    msg.addMessage({
      contentType: "text/plain",
      data: "Thanks for reaching out! We'll get back to you within 24 hours."
    });

    const replyMessage = new EmailMessage(
      "noreply@macksportreport.com",
      message.from,
      msg.asRaw()
    );

    await env.EMAIL.send(replyMessage);

    // Also forward original
    await message.forward("inbox@gmail.com");
  }
}
```

### Limitations to Know Cold

| Limitation | Detail |
|-----------|--------|
| Inbound only | Cannot send email via Email Routing |
| No storage | No inbox, no archive |
| No webmail | No UI to read email |
| Max addresses | 200 per zone |
| Attachment size | Limited by standard SMTP (typically 25MB) |
| No DKIM signing | Outbound messages not DKIM-signed by Email Routing |
| Forwarding loops | Must configure destination carefully |

---

## Dashboard Walkthrough

**Navigation:** macksportreport.com → Email → Email Routing

### Step 1: Enable Email Routing
1. Navigate to Email → Email Routing
2. Click **Get started** (first time) or **Enable**
3. Cloudflare prompts to add MX records — click **Add records and enable**
4. Cloudflare automatically adds the 3 MX records and updates SPF

### Step 2: Verify a Destination Address
1. Under **Destination addresses**, click **Add destination address**
2. Enter `youremail@gmail.com`
3. Check your Gmail for verification email from Cloudflare
4. Click the verification link

### Step 3: Create a Custom Address Rule
1. Under **Custom addresses**, click **Create address**
2. Enter local part: `info`
3. Select action: **Send to an email**
4. Select verified destination: `youremail@gmail.com`
5. Click **Save**

Result: `info@macksportreport.com` → `youremail@gmail.com`

### Step 4: Set Catch-All
1. At the bottom of the page, find **Catch-all address**
2. Toggle to enable
3. Select action: **Send to an email** or **Drop**
4. If sending: select verified destination
5. Click **Save**

### Step 5: Route to a Worker
1. Deploy an Email Worker (see Lab section)
2. When creating a custom address, select action: **Send to a Worker**
3. Select the deployed Worker from the dropdown

---

## Hands-On Lab

### Prerequisites
- macksportreport.com is an active Cloudflare zone
- You have access to an email address for verification
- Wrangler CLI installed: `npm install -g wrangler`
- Authenticated: `wrangler login`

### Lab 1: Enable Basic Email Routing via API

```bash
# Check current Email Routing status
curl -s -X GET "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/email/routing" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" | jq '.result'

# Enable Email Routing
curl -s -X POST "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/email/routing/enable" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" | jq '.'

# List current routing rules
curl -s -X GET "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/email/routing/rules" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" | jq '.result'
```

### Lab 2: Create a Routing Rule via API

```bash
# Create address-based routing rule
curl -s -X POST "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/email/routing/rules" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{
    "actions": [
      {
        "type": "forward",
        "value": ["youremail@gmail.com"]
      }
    ],
    "enabled": true,
    "matchers": [
      {
        "field": "to",
        "type": "literal",
        "value": "info@macksportreport.com"
      }
    ],
    "name": "Info Address",
    "priority": 10
  }' | jq '.'
```

### Lab 3: Deploy an Email Worker

```bash
# Create project directory
mkdir email-worker && cd email-worker

# Initialize
cat > package.json << 'EOF'
{
  "name": "email-worker",
  "version": "1.0.0",
  "devDependencies": {
    "wrangler": "^3.0.0"
  }
}
EOF

# Create wrangler.toml
cat > wrangler.toml << 'EOF'
name = "email-handler"
main = "src/index.js"
compatibility_date = "2024-09-23"

[[email]]
type = "email"
EOF

# Create the Worker
mkdir src
cat > src/index.js << 'EOF'
export default {
  async email(message, env, ctx) {
    const subject = message.headers.get("subject") || "(no subject)";
    const from = message.from;
    const to = message.to;

    console.log(`Received email: from=${from}, to=${to}, subject=${subject}`);

    // Route based on subject prefix
    if (subject.startsWith("[URGENT]")) {
      await message.forward("urgent@yourdomain.com");
    } else if (subject.startsWith("[SALES]")) {
      await message.forward("sales@yourdomain.com");
    } else {
      await message.forward("default@yourdomain.com");
    }
  }
};
EOF

# Deploy
npx wrangler deploy
```

### Lab 4: Check MX Records Were Added

```bash
# Verify MX records via DNS lookup
dig MX macksportreport.com +short

# Expected output:
# 17 route1.mx.cloudflare.net.
# 28 route2.mx.cloudflare.net.
# 50 route3.mx.cloudflare.net.

# Verify SPF record
dig TXT macksportreport.com +short | grep spf

# Check via Cloudflare API
curl -s -X GET "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records?type=MX" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" | jq '.result[] | {name, content, priority}'
```

### Lab 5: Test Email Delivery

```bash
# Send a test email using curl (SMTP test — requires local sendmail or mailx)
# Alternative: use swaks (Swiss Army Knife for SMTP)
# Install: brew install swaks

swaks \
  --to info@macksportreport.com \
  --from test@example.com \
  --server aspmx.l.google.com \
  --header "Subject: Test from curriculum lab" \
  --body "This is a test of Cloudflare Email Routing"

# Or test via online SMTP relay: https://mxtoolbox.com/emailhealth/
```

---

## Demo Script (2 Minutes)

**Audience:** Technical founder, startup CTO, indie developer

**Opening:**
> "You own macksportreport.com. You want info@macksportreport.com to be real. But you're not paying for Google Workspace, and you're definitely not running Postfix. Let me show you what Cloudflare does for free."

**Show:**
1. Navigate to Dashboard → Email → Email Routing
2. Show the MX records Cloudflare added automatically
3. Show an existing custom address rule: `info@macksportreport.com → youremail@gmail.com`
4. Show the catch-all rule
5. Click into Email Workers — show the code panel

**Closer:**
> "Free tier, five-minute setup, no server. And if you need custom logic — like routing urgent emails to a different inbox — there's a full serverless handler. This is the kind of thing that used to require a dedicated email admin."

---

## Competitive Context

| Capability | Cloudflare Email Routing | ImprovMX (free) | Forward Email | Google Workspace |
|-----------|--------------------------|-----------------|---------------|-----------------|
| Price | Free | Free (3 aliases) | Free / $3/mo | $6/user/mo |
| Custom addresses | 200 | 3 free / unlimited paid | Unlimited | Unlimited |
| Catch-all | Yes | Yes (paid) | Yes | Yes |
| Workers integration | Yes | No | No | No |
| Sending support | No | No | Yes (SMTP) | Yes |
| Inbox/webmail | No | No | No | Yes |
| DKIM signing | No | Yes | Yes | Yes |
| Setup time | ~5 min | ~5 min | ~10 min | ~30 min |

**When Cloudflare wins:** Zero cost, already using Cloudflare, need Workers integration for custom logic.

**When competitors win:** Need to send email, need webmail, need DKIM signing on forwarded mail.

**Honest limitation to acknowledge:** Cloudflare Email Routing is receive-only. For professional sending, you need to combine it with Mailgun, SendGrid, or Resend (all of which integrate cleanly with Workers).

---

## Self-Check Questions

**Q1: What DNS record type does Cloudflare add to your zone when Email Routing is enabled, and what is its purpose?**

```
Your answer:




```

**Q2: A customer wants to receive email at `orders@macksportreport.com` AND process the email with custom logic to log order confirmations to D1. What Cloudflare features would you configure, and in what order?**

```
Your answer:




```

**Q3: What is the difference between a custom address rule and a catch-all rule? Give an example of when you'd use each.**

```
Your answer:




```

**Q4: Why must destination addresses be verified before Cloudflare will forward email to them?**

```
Your answer:




```

**Q5: A customer enables Email Routing but their SPF record already includes `include:sendgrid.net`. What problem might arise, and how do you fix it?**

```
Your answer:




```

---

## Sources

- [Cloudflare Email Routing Documentation](https://developers.cloudflare.com/email-routing/)
- [Email Routing — Getting Started](https://developers.cloudflare.com/email-routing/get-started/)
- [Email Workers](https://developers.cloudflare.com/email-routing/email-workers/)
- [Email Routing API Reference](https://developers.cloudflare.com/api/operations/email-routing-settings-get-email-routing-settings)
- [SPF Record Documentation](https://developers.cloudflare.com/email-routing/setup/email-routing-addresses/)
- [MX Record Values](https://developers.cloudflare.com/email-routing/setup/)
- [Cloudflare Blog: Email Routing Launch](https://blog.cloudflare.com/migrating-to-cloudflare-email-routing/)
