# Module 6.10 — Network Settings
> **Dashboard Location:** macksportreport.com → Network (also Speed > Optimization in some views)
> **Estimated Time:** 55 minutes
> **Lab Domain:** macksportreport.com

---

## Theory (SE-Level)

### What Are Network Settings?

Network Settings are zone-level configuration toggles that control **how Cloudflare communicates with clients and origins at the protocol and transport layer**. These aren't rules — they're global settings that apply to your entire zone unless overridden per-request by Configuration Rules.

These settings are split across two dashboard locations:
- **Network tab** (macksportreport.com → Network): HTTP/2, HTTP/3, WebSockets, gRPC, Onion Routing
- **Speed > Optimization** (macksportreport.com → Speed > Optimization): Some performance-related network settings

For Solutions Engineers, these settings come up in:
- Performance conversations (HTTP/3, HTTP/2 push)
- Real-time app architecture (WebSockets, gRPC)
- Privacy discussions (Onion Routing)
- Legacy origin compatibility (Pseudo IPv4, True Client IP)
- Upload/API design (Max Upload Size)

---

## Deep Dive (Architect-Level)

### HTTP/2: Multiplexing and Header Compression

**What is HTTP/2?**

HTTP/2 (RFC 7540, standardized 2015) is the second major version of the HTTP protocol. It runs over TLS (HTTPS only in practice) and introduces:

1. **Multiplexing:** Multiple requests and responses share a single TCP connection simultaneously. HTTP/1.1 required one connection per concurrent request (or pipelining, which was unreliable). HTTP/2 eliminates head-of-line blocking at the HTTP layer.

2. **HPACK header compression:** HTTP headers are compressed using a static and dynamic table. Headers that appear in multiple requests (e.g., `Accept`, `User-Agent`, `Cookie`) are not retransmitted in full — only a reference to the table entry is sent. This reduces header overhead by 40-80%.

3. **Stream prioritization:** The client can signal which requests are higher priority. Critical resources (HTML, CSS blocking fonts) can be fetched before lower-priority assets.

4. **Server push (HTTP/2 Push):** Server proactively pushes resources the client will need before it asks. (Note: HTTP/2 Push has been controversial — Chrome deprecated its use for performance reasons.)

**Cloudflare HTTP/2 behavior:**
- Cloudflare terminates HTTP/2 connections from clients at the edge
- Cloudflare-to-origin connections may use HTTP/1.1 or HTTP/2 depending on origin support
- HTTP/2 requires HTTPS (HTTP/2 over plain text is technically in the spec but not supported in practice by any browser)
- The `http.request.version` field in rules returns `"HTTP/2"` for HTTP/2 requests

**Browser support:** All modern browsers support HTTP/2. Effectively 100% of non-legacy browser traffic supports HTTP/2.

**Enable/Disable toggle:** Found at macksportreport.com → Network → HTTP/2.

### HTTP/3 (QUIC): The UDP-Based Transport

**What is HTTP/3?**

HTTP/3 (RFC 9114, standardized 2022) replaces the TCP transport layer entirely with **QUIC** (Quick UDP Internet Connections), a UDP-based protocol that provides:

1. **0-RTT connection establishment:** Returning visitors can send HTTP requests immediately without a TLS handshake round trip (if they have a cached session ticket). Cold starts are 1-RTT vs HTTP/2's 2-3 RTTs.

2. **No head-of-line blocking at transport level:** HTTP/2 over TCP still suffers from TCP-level head-of-line blocking — if one TCP packet is lost, all streams stall. QUIC uses independent UDP streams; a lost packet only blocks the stream it belongs to.

3. **Connection migration:** QUIC connections survive IP address changes (e.g., when a mobile device switches from WiFi to cellular). The connection ID is separate from the IP address.

4. **Better performance on lossy networks:** Mobile networks with packet loss (2-5% loss is common on cellular) perform significantly better with QUIC's loss recovery vs TCP's.

**How browsers discover HTTP/3:**
When Cloudflare responds over HTTP/2 or HTTP/1.1, it includes an `Alt-Svc` header:
```
Alt-Svc: h3=":443"; ma=86400
```
This tells the browser: "HTTP/3 is available on port 443. Try it on your next request. Cache this for 86400 seconds."

On the next request, the browser attempts HTTP/3. If it succeeds, subsequent requests use HTTP/3 until the connection times out.

**Real-world performance benefit:** Google's research on QUIC (the basis for HTTP/3) showed:
- 3% reduction in mean page load time
- 30% reduction in video rebuffer rates on mobile
- Significant improvements on networks with >1% packet loss

**Enable/Disable:** macksportreport.com → Network → HTTP/3 (with QUIC).

**Note:** HTTP/3 requires UDP port 443 to be open for inbound traffic. Some enterprise firewalls block UDP/443. In that case, browsers fall back to HTTP/2 automatically.

### WebSockets: Persistent Bidirectional Connections

**What are WebSockets?**

WebSockets (RFC 6455) provide a persistent, bidirectional communication channel between browser and server over a single TCP connection. Unlike HTTP's request/response model, WebSockets allow either side to send messages at any time.

**The upgrade handshake:**
```
Client → Server (HTTP):
GET /chat HTTP/1.1
Host: macksportreport.com
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==

Server → Client (HTTP 101):
HTTP/1.1 101 Switching Protocols
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=
```

After the 101 response, the TCP connection is "upgraded" to WebSocket protocol and stays open indefinitely.

**Cloudflare WebSocket support:**
- Cloudflare proxies WebSocket connections transparently
- WebSocket timeout: connections are terminated by Cloudflare after a period of inactivity (default: 60 seconds)
- For long-lived connections, configure origin ping/pong to keep alive
- The `WebSocket` toggle at Network must be enabled for Cloudflare to proxy WS upgrades

**Use cases:**
- Live sports scores and play-by-play (perfect for macksportreport.com!)
- Chat applications
- Live dashboards and analytics
- Collaborative editing tools
- Online gaming
- Financial data feeds (stock tickers, order books)

**Workers WebSocket support:**
Workers can accept and handle WebSocket connections directly using the `WebSocketPair` API. This allows serverless bidirectional communication without a traditional origin server.

### gRPC: HTTP/2-Based RPC Framework

**What is gRPC?**

gRPC is Google's open-source remote procedure call framework (2015). It uses:
- **HTTP/2** as the transport (multiple streams, multiplexing)
- **Protocol Buffers (protobuf)** as the serialization format (binary, compact)
- **Streaming support:** unary (1 req, 1 resp), server streaming, client streaming, bidirectional streaming

**Why proxy gRPC through Cloudflare?**
- WAF protection on gRPC API traffic
- DDoS protection
- Bot protection
- Global PoP distribution and caching for unary gRPC responses
- Consistent SSL termination

**Enabling gRPC on Cloudflare:**
- Enable the gRPC toggle: macksportreport.com → Network → gRPC
- Requires HTTP/2 to be enabled (gRPC is built on HTTP/2)
- gRPC-Web is also supported (for browser clients that can't use native gRPC)

**Note:** gRPC streaming traffic (long-lived, streaming RPCs) has specific timeout considerations. Cloudflare's default timeouts apply; very long-running streaming connections may be terminated.

### Onion Routing: Accessing Your Site via Tor

**What is Onion Routing?**

When enabled, Cloudflare provisions a `.onion` address for your zone (e.g., `abc123def456.cloudflare-onion.com`). Users connecting via the Tor Browser can access your site via the Tor network without their traffic ever touching the public internet.

**Why enable Onion Routing?**
- **Privacy:** Tor users can access your site without revealing their IP to Cloudflare's edge PoPs
- **Accessibility:** Some countries or networks block your domain; Tor provides an alternative access method
- **Journalistic/activist use cases:** Publications like The New York Times, ProPublica, and the BBC offer `.onion` addresses for safety-critical access
- **HTTPS upgrade:** Tor traffic is served via HTTPS even when accessed via `.onion`, providing end-to-end encryption

**How it works:**
1. Cloudflare provisions a unique `.onion` address for your zone
2. The `onion-location` HTTP header is added to responses (tells Tor Browser to prefer the onion address)
3. Tor Browser automatically redirects to the onion address when available
4. Cloudflare's Tor entry nodes accept traffic and route internally

**Not a significant business driver for most customers** — but for media, journalism, privacy, and international accessibility use cases, it's a differentiating feature.

### IP Geolocation Header

When enabled, Cloudflare adds a `CF-IPCountry` header to every request forwarded to your origin. This allows your application to make country-based decisions without implementing geolocation logic yourself.

```
CF-IPCountry: US
CF-IPCountry: GB
CF-IPCountry: T1   # Tor network
CF-IPCountry: XX   # Unknown
```

**Enable:** macksportreport.com → Network → IP Geolocation.

**Note:** This is also available as a Managed Transform (Module 6.2) — the Managed Transform adds more geolocation headers (city, region, lat/long). The Network toggle is the simpler, country-only version.

### Max Upload Size

Controls the maximum size of request bodies (uploads) that Cloudflare will accept and forward to your origin:

| Plan | Default Max | Maximum |
|---|---|---|
| Free | 100 MB | 100 MB |
| Pro | 100 MB | 100 MB |
| Business | 200 MB | 200 MB |
| Enterprise | 500 MB+ | Configurable |

Requests exceeding the limit are rejected with a 413 (Request Entity Too Large) error before reaching origin. This provides DDoS protection against oversized upload attacks.

**Configuration:** Network → Maximum Upload Size.

### Pseudo IPv4

Some origin servers are IPv4-only and break when they receive requests from IPv6 clients. Pseudo IPv4 maps an IPv6 address to a pseudo-IPv4 address and provides it to the origin:

**Modes:**
- **Off:** No mapping (default)
- **Add Header:** Adds a `Cf-Pseudo-IPv4` header with the mapped pseudo-IPv4 value
- **Overwrite Headers:** Replaces `CF-Connecting-IP` and `X-Forwarded-For` with the pseudo-IPv4 value

**When to use:** Legacy origin applications that parse `CF-Connecting-IP` and fail on IPv6 addresses.

### True Client IP Header

When enabled, Cloudflare adds a `True-Client-IP` header containing the visitor's real IP address. This is similar to `CF-Connecting-IP` but uses a different header name for compatibility with legacy applications that expect it.

**Enable:** Network → True-Client-IP Header.

**Note:** The `CF-Connecting-IP` header is always added by Cloudflare to proxied requests. `True-Client-IP` is an additional header for cases where applications specifically look for that header name.

### Response Buffering

When enabled, Cloudflare waits to receive the full origin response before sending it to the client. When disabled (default), Cloudflare streams the response as it receives it from origin.

**When to enable buffering:**
- Origin sends malformed or incomplete responses that need to be fully received before processing
- Specific use cases where streaming causes client issues

**Default behavior:** Disabled (streaming) — better for large file downloads and real-time responses.

---

## Dashboard Walkthrough

### Step 1: Navigate to Network Settings
1. macksportreport.com → Left sidebar → **Network**
2. You'll see toggles for: HTTP/2, HTTP/3, WebSockets, gRPC, Onion Routing, IP Geolocation, Pseudo IPv4, True-Client-IP, etc.

### Step 2: Enable HTTP/3
1. Find the **HTTP/3 (with QUIC)** toggle
2. If HTTP/2 is enabled, HTTP/3 can be enabled
3. Toggle **ON** → Save
4. Verify: request your site and check response headers for `Alt-Svc`:
   ```
   Alt-Svc: h3=":443"; ma=86400
   ```

### Step 3: Enable WebSockets (If Not Already)
1. Toggle **WebSockets** → **ON**
2. This is required for any site with real-time functionality
3. Default is ON on most plans

### Step 4: Enable IP Geolocation
1. Toggle **IP Geolocation** → **ON**
2. Your origin will now receive `CF-IPCountry` header on all requests

### Step 5: Check HTTP/3 with a Browser
1. Open `https://macksportreport.com` in Chrome
2. DevTools → Network
3. Right-click column headers → Add "Protocol" column
4. Reload the page
5. Look for `h3` in the Protocol column — indicates HTTP/3 was used

### Step 6: Verify with curl
```bash
# Check for Alt-Svc header (signals HTTP/3 availability)
curl -s -I https://macksportreport.com | grep -i "alt-svc\|http2\|http3"

# Check HTTP version used
curl -s -w "%{http_version}\n" -o /dev/null https://macksportreport.com
```

---

## Hands-On Lab

### Lab 1: Verify Current HTTP/2 and HTTP/3 Status

```bash
export CF_API_TOKEN="your_api_token"
export ZONE_ID="your_zone_id"

# Check HTTP/2 setting
curl -s -X GET \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/settings/http2" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" | jq '{setting: .result.id, value: .result.value}'

# Check HTTP/3 setting
curl -s -X GET \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/settings/http3" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" | jq '{setting: .result.id, value: .result.value}'

# Check WebSockets setting
curl -s -X GET \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/settings/websockets" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" | jq '{setting: .result.id, value: .result.value}'
```

### Lab 2: Enable HTTP/3 via API

```bash
# Enable HTTP/3 (requires HTTP/2 to be on first)
curl -s -X PATCH \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/settings/http3" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"value": "on"}' | jq '{id: .result.id, value: .result.value}'
```

### Lab 3: Verify HTTP/3 via Alt-Svc Header

```bash
# Check that Alt-Svc header is present after enabling HTTP/3
curl -s -I https://macksportreport.com | grep -i alt-svc

# Expected output:
# alt-svc: h3=":443"; ma=86400
```

### Lab 4: Enable IP Geolocation and Test

```bash
# Enable IP Geolocation header
curl -s -X PATCH \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/settings/ip_geolocation" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"value": "on"}' | jq '{id: .result.id, value: .result.value}'

# Test: make a request and check if CF-IPCountry would be sent to origin
# Note: CF-IPCountry is a REQUEST header sent to origin, not a response header
# You can verify this by checking your origin access logs after the next request
curl -s https://macksportreport.com/ -D - 2>&1 | head -20
```

### Lab 5: Test WebSocket Connectivity

```bash
# Install wscat if available (Node.js WebSocket CLI client)
# npm install -g wscat

# Test WebSocket connection to an echo server or your own WS endpoint
# wscat -c wss://macksportreport.com/ws

# Alternative: use curl to check WebSocket upgrade support
curl -s -I \
  -H "Upgrade: websocket" \
  -H "Connection: Upgrade" \
  -H "Sec-WebSocket-Key: $(openssl rand -base64 16)" \
  -H "Sec-WebSocket-Version: 13" \
  https://macksportreport.com/ws 2>&1 | grep -E "HTTP|upgrade|Upgrade|101"
# If WebSockets are configured on origin: expect 101 Switching Protocols
# If no WS endpoint: expect 404 or 400 (still confirms CF is proxying WS)
```

### Lab 6: Check All Network Settings via API Bulk Endpoint

```bash
# Get all zone settings at once (includes all network settings)
curl -s -X GET \
  "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/settings" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" | \
  jq '.result[] | select(.id | test("http2|http3|websockets|grpc|ip_geolocation|pseudo_ipv4|true_client_ip|response_buffering|max_upload")) | {id, value}'
```

Expected output includes all current toggle states:
```json
{"id": "http2", "value": "on"}
{"id": "http3", "value": "on"}
{"id": "websockets", "value": "on"}
{"id": "grpc", "value": "off"}
{"id": "ip_geolocation", "value": "on"}
```

---

## Demo Script (2 Minutes)

**Audience:** Mobile-first sports app developer concerned about performance on cellular networks

---

*"Your app serves real-time sports data — live scores, play-by-play. Your users are at stadiums, on trains, in areas with spotty cellular coverage. That's exactly where HTTP/3 shines."*

[Navigate to macksportreport.com → Network]

*"One toggle: HTTP/3. On. What this does is switch your transport protocol from TCP to QUIC — which runs over UDP. When a TCP packet is lost on a bad cellular connection, ALL your data streams stall until that packet is retransmitted. That's what makes apps feel laggy on cell towers."*

*"QUIC is independent streams per request. If one packet drops on one request, only that request pauses. Everything else keeps flowing. Google's own research showed 30% fewer video rebuffers on mobile just from switching to QUIC."*

[Show Alt-Svc header in curl output]

*"Cloudflare announces HTTP/3 support via this `Alt-Svc` header. Browsers that support it — Chrome, Firefox, Safari — will try HTTP/3 on the next request. If it works, they stick with it. If a firewall blocks UDP/443, they automatically fall back to HTTP/2. Zero risk."*

[Navigate back to WebSockets toggle]

*"And for your live scoring — WebSockets. One toggle, proxied by Cloudflare's full stack. Your DDoS protection, your WAF, your bot protection — all apply to WebSocket traffic too. Most CDNs either don't proxy WebSockets or charge extra for it."*

---

## Competitive Context

| Feature | Cloudflare | AWS CloudFront | Akamai | Fastly |
|---|---|---|---|---|
| **HTTP/3 (QUIC)** | Yes — toggle in dashboard | Yes (CloudFront 2020+) | Yes | Yes |
| **WebSocket proxying** | Yes — included | Yes — requires config | Yes | Yes |
| **gRPC support** | Yes — toggle | Yes (must configure) | Yes | Yes |
| **HTTP/2 multiplexing** | Yes | Yes | Yes | Yes |
| **0-RTT (QUIC)** | Yes | Yes | Yes | Yes |
| **Onion Routing (Tor)** | Yes — unique feature | No | No | No |
| **True-Client-IP header** | Yes | Custom header config | Yes | Via VCL |
| **IP Geolocation header** | Yes | No native (Lambda) | Yes | Yes |
| **Max upload size control** | Yes — per plan | Yes — config | Yes | Yes |
| **WebSocket timeout control** | Limited (default) | Configurable | Configurable | VCL configurable |

**Unique Cloudflare differentiator:** Onion Routing is unique to Cloudflare — no other major CDN provides native Tor `.onion` address provisioning and Tor network integration. For privacy-critical publishers, this is a genuine differentiator.

---

## Self-Check Questions

**Question 1:** A customer reports that HTTP/3 is enabled but no users are actually using it. Their security team uses Zscaler as a network proxy. What is the likely cause, and how would you diagnose it?

```
Your answer:
_______________________________________________
_______________________________________________
_______________________________________________
```

**Question 2:** Explain the difference between head-of-line blocking in HTTP/1.1, HTTP/2, and HTTP/3. Why does QUIC solve a problem that HTTP/2 over TCP does not?

```
Your answer:
_______________________________________________
_______________________________________________
_______________________________________________
_______________________________________________
```

**Question 3:** A developer is building a live sports scoring feature. They're choosing between (a) polling the API every 5 seconds, (b) Server-Sent Events, and (c) WebSockets. Compare these three approaches in terms of latency, server load, and Cloudflare compatibility.

```
Your answer:
_______________________________________________
_______________________________________________
_______________________________________________
_______________________________________________
```

**Question 4:** A customer asks: "My API uses gRPC for internal microservice communication. Should I route that traffic through Cloudflare?" What questions would you ask to determine if Cloudflare is the right solution, and what are the benefits/tradeoffs?

```
Your answer:
_______________________________________________
_______________________________________________
_______________________________________________
```

**Question 5:** What is the `True-Client-IP` header and why does it exist alongside `CF-Connecting-IP`? When would you recommend enabling it?

```
Your answer:
_______________________________________________
_______________________________________________
_______________________________________________
```

---

## Sources

- [HTTP/2 Documentation](https://developers.cloudflare.com/speed/optimization/protocol/http2/)
- [HTTP/3 / QUIC Documentation](https://developers.cloudflare.com/speed/optimization/protocol/http3/)
- [WebSockets Documentation](https://developers.cloudflare.com/network/websockets/)
- [gRPC Documentation](https://developers.cloudflare.com/network/grpc/)
- [Onion Routing Documentation](https://developers.cloudflare.com/network/onion-routing/)
- [True Client IP Header](https://developers.cloudflare.com/network/ip-geolocation/)
- [IP Geolocation Header](https://developers.cloudflare.com/network/ip-geolocation/)
- [Network Settings API](https://developers.cloudflare.com/api/operations/zone-settings-get-all-zone-settings)
- [RFC 9114 — HTTP/3](https://www.rfc-editor.org/rfc/rfc9114)
- [RFC 9000 — QUIC Transport Protocol](https://www.rfc-editor.org/rfc/rfc9000)
- [RFC 6455 — WebSocket Protocol](https://www.rfc-editor.org/rfc/rfc6455)
