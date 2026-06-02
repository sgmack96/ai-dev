# Module 12.5 — Remote Browser Isolation (RBI)
> Dashboard Location: Zero Trust → Browser Isolation | Estimated Time: 60 min | Lab Domain: macksportreport.com

---

## Theory (SE-Level)

Remote Browser Isolation (RBI) runs a browser inside Cloudflare's infrastructure and streams the visual result to the user's device. Instead of the user's browser executing JavaScript, rendering HTML, and running plugins locally — all of that happens in Cloudflare's cloud. What reaches the user's device is a stream of rendered pixels.

**The security model in one sentence:** Malicious code runs in Cloudflare's throwaway browser, not on your user's computer.

**Why this matters:**
- A user clicks a phishing link. Without RBI: the phishing page loads in their browser, JavaScript executes, credentials potentially stolen. With RBI: the page loads in Cloudflare's browser. The user sees the page but the malicious JavaScript runs in a sandboxed environment with no access to local files, clipboard (by policy), or stored credentials.
- A contractor needs to access an internal app but you can't install software on their personal device. With clientless RBI, you send them a special URL. They access your internal app inside an isolated browser with controlled clipboard, no file downloads. The internal app's data never touches their device.

**Two deployment modes:**
1. **With WARP:** Gateway HTTP policies automatically isolate matching URLs. Seamless to the user.
2. **Clientless (no WARP):** Share a special isolation link. Works in any browser. No installation needed.

---

## Deep Dive (Architect-Level)

### How Isolation Works Technically

Cloudflare runs a headless Chromium instance for each isolated browsing session. The render loop:

1. User requests `https://suspicious-site.com` → Gateway HTTP policy routes to isolation
2. Cloudflare's isolated browser makes the actual HTTP request and renders the page
3. The rendering engine produces "draw commands" — a high-efficiency vector description of what to display
4. Draw commands are streamed to the user's browser via WebSocket
5. The user's browser renders the draw commands (no HTML/JS from the page executes locally)
6. User keyboard/mouse input is sent back to the isolated browser via WebSocket
7. The isolated browser processes input and produces new draw commands

The user perceives normal browsing. The actual browser execution is entirely remote.

### What Gets Controlled

RBI gives administrators fine-grained control over what can flow between the isolated session and the user's local environment:

| Control | Options |
|---|---|
| **Clipboard** | Allow copy/paste, block copy-out, block paste-in, block both |
| **File downloads** | Allow all, block all, allow with AV scan |
| **File uploads** | Allow, block |
| **Keyboard input** | Allow, disable (read-only session) |
| **Printing** | Allow, block |
| **Cookies** | Persistent, session-only |

**Example policy:** Contractors accessing a CRM:
- Clipboard paste: Allow (they can type case numbers to search)
- Clipboard copy: Block (they can't copy customer data out)
- File download: Block (no data exfiltration via file download)
- File upload: Allow (they need to attach files to tickets)

### Non-Clientless RBI (With WARP)

When WARP is installed, Gateway HTTP policies automatically isolate specified URLs. The user doesn't know they're isolated — their browser tab looks normal, but the isolation is active.

**Policy example:**
- Traffic type: HTTP
- URL category: Newly registered domains (last 30 days)
- Action: Isolate

This automatically opens any domain registered in the last 30 days (high-risk for phishing) in an isolated session, without the user doing anything differently.

### Clientless RBI (No WARP)

For users without WARP (contractors, BYOD, B2B partners):

1. Zero Trust → Browser Isolation → Clientless RBI
2. Get your organization's isolation URL: `https://macksportreport.cloudflareaccess.com/browser`
3. Append the target URL: `https://macksportreport.cloudflareaccess.com/browser/https://internal-app.macksportreport.com`
4. User opens this link in any browser — they get Access authentication prompt, then the isolated session

Combined with Access, contractors can access internal apps from personal devices without any client installation and without any corporate data touching their device.

### Performance Characteristics

RBI adds latency because the browsing session is remote:
- Typical additional latency: 50-150ms (depending on proximity to CF PoP running the browser)
- Page load "feel": slightly slower, especially for complex animations
- Interactive elements (forms, clicks): ~100ms additional round-trip
- Video playback: not recommended through RBI; typically excluded via policy

Users notice the latency for interactive work. For read-heavy workflows (reading a report, reviewing a document), the experience is acceptable.

### Use Cases by Persona

| Persona | Use Case | Configuration |
|---|---|---|
| **Security-conscious enterprise** | Isolate all risky website categories | Gateway policy: isolate malware/phishing/newly-registered domains |
| **Financial services** | All internet browsing isolated | Isolate everything; block clipboard copy-out |
| **B2B partner access** | Third-party accesses internal app | Clientless RBI link + Access policy |
| **BYOD contractor** | Access internal tools on personal device | Clientless RBI, block file downloads |
| **Incident response** | Security analyst must visit suspected malware URL | Send URL through isolation prefix |
| **Legal/compliance** | Preserve evidence: analyst must visit suspicious URL without contaminating machine | Isolated session with logging |

---

## Dashboard Walkthrough

**Step 1: Enable Browser Isolation**
1. Zero Trust → Browser Isolation
2. Review: Clientless browsing is available by default
3. Note the isolation URL: `{team}.cloudflareaccess.com/browser`

**Step 2: Create an HTTP Policy to Isolate Risky Sites**
1. Zero Trust → Gateway → Firewall Policies → HTTP
2. Click "Add a policy"
3. Name: `Isolate Risky Domains`
4. Traffic:
   - Category: Newly Registered Domains
   - OR: Category: Parked Domains
5. Action: Isolate
6. Additional settings:
   - Disable clipboard copy: Yes
   - Disable file downloads: No (allow with AV scan)
7. Save

**Step 3: Test Clientless Isolation**
1. In your browser (not enrolled in WARP), navigate to:
   `https://macksportreport.cloudflareaccess.com/browser/https://example.com`
2. You'll be prompted to authenticate via Access
3. After authentication, `example.com` opens in the isolated browser
4. Notice: slight latency, visual rendering via draw commands

**Step 4: Configure Clipboard Restrictions**
1. In the HTTP policy (Step 2), click "Configure remote browser isolation settings"
2. Disable clipboard upload (paste-in): No (allow)
3. Disable clipboard download (copy-out): Yes (block exfiltration)
4. Disable keyboard: No (read-only mode, not recommended for general use)

**Step 5: View Isolation Analytics**
1. Zero Trust → Analytics → Browser Isolation
2. See: isolation sessions, bandwidth consumed, AV scans triggered, files blocked

---

## Hands-On Lab

### Prerequisites
```bash
export CF_ACCOUNT_ID="your-account-id"
export CF_API_TOKEN="your-api-token-with-zero-trust-write"

# WARP must be installed and enrolled for automated isolation policies
# For clientless testing, only a browser is needed
```

### Lab 1: Create an Isolation Policy via API
```bash
# Create HTTP policy to isolate newly registered domains
curl -X POST "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/gateway/rules" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{
    "name": "Isolate Newly Registered Domains",
    "description": "Isolate domains registered in the last 30 days (high phishing risk)",
    "action": "isolate",
    "enabled": true,
    "filters": ["http"],
    "traffic": "any(http.request.domains[*] in $newly_seen_domains)",
    "precedence": 10,
    "rule_settings": {
      "browser_isolation": {
        "non_identity_enabled": false,
        "isolation_required": true
      }
    }
  }'
```

### Lab 2: Test Clientless RBI
```bash
# Replace with your actual team domain
TEAM_DOMAIN="macksportreport.cloudflareaccess.com"

# Construct isolation URL
TARGET_URL="https://example.com"
ISOLATION_URL="https://${TEAM_DOMAIN}/browser/${TARGET_URL}"

echo "Open this URL in a browser (no WARP needed):"
echo "${ISOLATION_URL}"

# The page will:
# 1. Prompt for authentication (Access login)
# 2. Open example.com in an isolated browser session
# 3. All JS executes remotely, not locally
```

### Lab 3: Test Clipboard Control
```bash
# After opening an isolated session, try:
# 1. Copy text from the isolated page (Ctrl+C / Cmd+C)
# 2. Paste into a local text editor
# If "disable clipboard download" is enabled, paste will be empty

# Similarly:
# 1. Copy text from your local machine
# 2. Try pasting into a form in the isolated session
# If "disable clipboard upload" is enabled, paste will fail
```

### Lab 4: Exclude Specific Domains from Isolation
```bash
# Some domains cause issues with isolation (certificate pinning, WebRTC, streaming)
# Create a bypass rule with higher precedence

curl -X POST "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/gateway/rules" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{
    "name": "Bypass Isolation for Trusted Domains",
    "description": "Do not isolate trusted corporate and productivity apps",
    "action": "allow",
    "enabled": true,
    "filters": ["http"],
    "traffic": "any(http.request.domains[*] in {\"google.com\" \"microsoft.com\" \"zoom.us\" \"slack.com\"})",
    "precedence": 1
  }'
```

### Lab 5: View Isolation Sessions via API
```bash
# List recent isolated browsing sessions
curl "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/gateway/activity_log?type=http&action=isolate&limit=50" \
  -H "Authorization: Bearer ${CF_API_TOKEN}"
```

### Lab 6: Isolation for Contractor Access Pattern
```bash
# Full workflow for contractor without WARP:
# 1. Create Access application for internal tool
# 2. Set application type to "self-hosted"
# 3. Enable "browser rendering" for clientless access
# 4. Share the isolation URL with contractor:
#    https://{team}.cloudflareaccess.com/browser/https://internal-tool.macksportreport.com
# 5. Contractor authenticates via Access
# 6. Sees internal tool in isolated session
# 7. Cannot download data, cannot copy data out (per policy)
# 8. All session activity logged in Access audit logs
echo "Share this URL with the contractor:"
echo "https://${TEAM_DOMAIN}/browser/https://internal-tool.macksportreport.com"
```

---

## Demo Script (2 Minutes)

**Audience:** CISO or Security Director at a financial services or legal firm

**Opening (20 seconds):**
"When your analysts click a suspicious link as part of their investigation, or when a phishing email gets through and someone clicks it — what happens? That malicious JavaScript runs on their endpoint, in their browser, with access to their cookies and local files."

**Act 1 — Explain the isolation model (30 seconds):**
"Remote Browser Isolation runs the browser somewhere else — in Cloudflare's cloud. What your employee sees is a pixel stream, not a real web page executing on their machine. A keylogger in the JavaScript can't reach their keyboard. A drive-by download can't write to their filesystem. The malicious code runs and dies in a throwaway container."

**Act 2 — Show clientless mode (30 seconds):**
"For contractors, there's no client to install. I share a special link — [show URL structure]. They open it in Chrome, authenticate with their Google account, and see your internal application. Except they can't copy data out, they can't download files, and the app never loads on their device. Zero data exfiltration risk."

**Act 3 — Show automatic policies (20 seconds):**
"For enrolled employees with WARP, any site matching my Gateway policy — newly registered domains, high-risk categories — automatically opens in isolation. They don't see any difference. The protection is invisible."

**Close (20 seconds):**
"This is how financial services and law firms protect against browser-based attacks and insider data exfiltration simultaneously. It's an add-on to the Zero Trust platform. How are you currently protecting browser activity on contractor devices?"

---

## Competitive Context

| Feature | Cloudflare RBI | Menlo Security | Ericom Shield | Zscaler Cloud Browser Isolation | VMware Horizon (VDI) |
|---|---|---|---|---|---|
| **Architecture** | Headless Chromium, draw commands | Headless Chromium | Remote browser | Cloud browser | Full VM |
| **Clientless mode** | Yes (link-based) | Yes | Yes | Yes | No (client required) |
| **WARP integration** | Native | No | No | ZPA client | No |
| **Clipboard control** | Yes (granular) | Yes | Yes | Yes | Yes |
| **File download control** | Yes | Yes | Yes | Yes | Yes |
| **Keyboard control** | Yes (read-only mode) | Yes | Yes | Yes | Yes |
| **Latency** | 50-150ms added | 50-200ms added | 100-200ms added | 50-150ms added | 100-400ms added |
| **AV scanning on download** | Yes | Yes | Yes | Yes | Depends |
| **Access integration** | Native | No | No | ZPA only | No |
| **Gateway policy trigger** | Yes (automatic) | Manual | Manual | ZIA policy | Manual |
| **Cost** | Add-on to ZT seat | ~$10-20/user/mo | ~$8-15/user/mo | Add-on to ZIA | ~$15-40/user/mo + infra |

**Key positioning:** Cloudflare RBI is the only solution that integrates isolation as a Gateway HTTP policy action — meaning isolation is triggered automatically based on URL categories, not manually configured per URL. And the Access integration for clientless contractor access is unique.

---

## Self-Check Questions

**Question 1:** Explain in technical terms what "draw commands" means in the RBI architecture. Why does streaming draw commands instead of raw HTML/JS prevent malware from executing on the user's device?

```
Your answer:




```

**Question 2:** A legal firm needs contractors to review confidential documents in an internal web app. The contractors use personal devices. The firm cannot allow any data to be copied or downloaded to the personal device. Describe the exact RBI configuration to achieve this.

```
Your answer:




```

**Question 3:** What is the expected latency impact of RBI and why? For what types of workflows is this acceptable, and for what types is it not?

```
Your answer:




```

**Question 4:** What is the difference between clientless RBI and WARP-based RBI? When would you use each?

```
Your answer:




```

**Question 5:** A security analyst needs to visit a suspected phishing URL to gather intelligence. Describe how RBI protects their workstation and what they should configure before visiting the URL.

```
Your answer:




```

---

## Sources

- [Cloudflare Browser Isolation Documentation](https://developers.cloudflare.com/cloudflare-one/policies/browser-isolation/)
- [Clientless RBI](https://developers.cloudflare.com/cloudflare-one/policies/browser-isolation/clientless-browser-isolation/)
- [RBI Isolation Policies](https://developers.cloudflare.com/cloudflare-one/policies/browser-isolation/isolation-policies/)
- [RBI Permissions](https://developers.cloudflare.com/cloudflare-one/policies/browser-isolation/isolation-policies/permissions/)
- [Gateway HTTP Policies + Isolation](https://developers.cloudflare.com/cloudflare-one/policies/gateway/http-policies/#isolate)
- [Cloudflare Blog: Browser Isolation](https://blog.cloudflare.com/cloudflare-browser-isolation/)
- [Menlo Security Architecture Comparison](https://www.menlosecurity.com/how-we-work)
- [NIST Guidelines for TIC 3.0 (Zero Trust web isolation)](https://www.cisa.gov/sites/default/files/publications/CISA%20TIC%203.0%20Vol.%202%20Reference%20Architecture.pdf)
