# Module 12.3 — Cloudflare Tunnel
> Dashboard Location: Zero Trust → Networks → Tunnels | Estimated Time: 75 min | Lab Domain: macksportreport.com

---

## Theory (SE-Level)

Cloudflare Tunnel (formerly Argo Tunnel) creates an outbound-only encrypted connection from your server to Cloudflare's network. This inverts the traditional model: instead of opening inbound firewall ports and exposing your server's IP, your server reaches out to Cloudflare, and Cloudflare routes inbound requests back through that connection.

**The traditional problem:** To expose an internal web service to the internet, you need to:
1. Get a public IP address
2. Configure firewall rules to allow inbound traffic on port 80/443
3. Point DNS to your public IP (now your IP is public knowledge)
4. Maintain SSL certificates
5. Hope attackers don't find and exploit your exposed ports

Every one of these steps is a security and operational burden. And once your IP is known, it can be attacked directly — bypassing any Cloudflare protections.

**With Cloudflare Tunnel:**
1. Install `cloudflared` on your server
2. Authenticate and create a tunnel
3. Your server opens outbound connections to Cloudflare (ports 7844 or 443)
4. No inbound firewall rules needed
5. Origin IP is never exposed — traffic comes back through Cloudflare
6. SSL certificates: handled automatically by Cloudflare

**The security model:** Your server's firewall can block ALL inbound connections. The only connections that reach your server are the ones Cloudflare sends through the tunnel — which can be gated by Access policies, WAF rules, and DDoS protection.

---

## Deep Dive (Architect-Level)

### Connection Architecture

```
Internet User
      │
      │ HTTPS: app.macksportreport.com
      ▼
Cloudflare Edge (anycast IP, port 443)
      │
      │ [Internal Cloudflare routing]
      ▼
Cloudflare Tunnel Termination (edge PoP)
      │
      │ [H2mux/QUIC over TLS, through existing cloudflared connection]
      ▼
cloudflared process (on your server)
      │
      │ HTTP/HTTPS to localhost
      ▼
Your Application (localhost:3000 or any service)
```

The `cloudflared` daemon maintains 4 connections to 2 different Cloudflare PoPs (2 connections each) for high availability. If one connection drops, the others continue to route traffic without interruption.

### Tunnel Configuration

`cloudflared` uses a config.yml file to define ingress rules:

```yaml
# ~/.cloudflared/config.yml
tunnel: your-tunnel-id
credentials-file: /home/user/.cloudflared/your-tunnel-id.json

ingress:
  # Route staging subdomain to local app on port 3000
  - hostname: staging.macksportreport.com
    service: http://localhost:3000

  # Route API subdomain to local service on port 8080
  - hostname: api.macksportreport.com
    service: http://localhost:8080
    originRequest:
      connectTimeout: 30s
      tlsTimeout: 30s

  # Route everything else to a 404 page
  - service: http_status:404
```

### Private Network Routing

Tunnel is not limited to HTTP. With private network routing, you expose an entire IP range through the tunnel — enabling WARP clients to access your private network without a traditional VPN:

```yaml
# Expose 10.0.0.0/8 private network through tunnel
ingress:
  - service: tcp://10.0.0.1
    originRequest:
      proxyType: socks

# And in cloudflared: add route for the network
# cloudflared tunnel route ip add 10.0.0.0/8 your-tunnel-id
```

With this configuration, employees running WARP can reach any device at `10.x.x.x` — their entire corporate network — without a VPN.

### Integration with Access

The canonical Zero Trust pattern:
1. **Tunnel** exposes the internal app (no firewall ports, origin IP hidden)
2. **Access** protects the app (authentication required, every login audited)
3. **WARP** (optional) provides device posture checks

This means: the app is exposed to the internet via Tunnel, but it's not publicly accessible — Access blocks all requests that aren't authenticated. Your origin server only receives requests that have passed through Cloudflare's security stack.

### Kubernetes Integration

`cloudflared` can run as a Kubernetes Deployment, acting as an ingress controller:

```yaml
# kubernetes-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: cloudflared
spec:
  replicas: 2  # Two replicas = 4 connections total (2 per replica)
  template:
    spec:
      containers:
      - name: cloudflared
        image: cloudflare/cloudflared:latest
        args:
        - tunnel
        - --config
        - /etc/cloudflared/config.yml
        - run
        volumeMounts:
        - name: config
          mountPath: /etc/cloudflared
        - name: creds
          mountPath: /etc/cloudflared-creds
```

### Remotely-Managed Tunnels

Tunnels can be configured entirely from the Cloudflare dashboard without any local config file:
1. Create tunnel in Zero Trust → Networks → Tunnels
2. Configure ingress rules in the dashboard
3. `cloudflared` reads its config from the Cloudflare API

This is the recommended approach for production — no local config files to manage or version.

---

## Dashboard Walkthrough

**Step 1: Create a Tunnel**
1. Zero Trust → Networks → Tunnels
2. Click "Create a tunnel"
3. Choose: Cloudflared connector
4. Tunnel name: `macksportreport-prod`
5. Install cloudflared: follow OS-specific instructions shown
6. Run the install command (includes your tunnel token)

**Step 2: Configure Public Hostnames**
1. After cloudflared connects, you'll see "Your connector is healthy"
2. Add public hostname:
   - Subdomain: `staging`, Domain: `macksportreport.com`
   - Service type: HTTP, URL: `localhost:3000`
3. Click "Save hostname"

**Step 3: Verify DNS**
1. Dashboard automatically creates a CNAME:
   `staging.macksportreport.com → your-tunnel-id.cfargotunnel.com`
2. Verify: `dig staging.macksportreport.com`

**Step 4: Add Private Network (Optional)**
1. Private Network tab
2. Add: `10.0.0.0/8` (or your internal subnet)
3. Now WARP users can access 10.x.x.x through the tunnel

**Step 5: Monitor Tunnel Health**
1. Tunnel details → Connector status
2. See: active connections, connection counts, errors
3. Tunnel should show 4 active connections (2 per PoP)

---

## Hands-On Lab

### Prerequisites
```bash
# macOS install
brew install cloudflare/cloudflare/cloudflared

# Linux (Debian/Ubuntu)
curl -L https://pkg.cloudflare.com/cloudflared-stable-linux-amd64.deb -o cloudflared.deb
sudo dpkg -i cloudflared.deb

# Verify install
cloudflared --version
```

### Lab 1: Create a Tunnel and Run a Test Service
```bash
# Step 1: Authenticate (opens browser)
cloudflared tunnel login
# Authorizes cloudflared to manage tunnels for your account

# Step 2: Create tunnel
cloudflared tunnel create macksportreport-test
# Note: saves credential file to ~/.cloudflared/{tunnel-id}.json

# Step 3: Start a test HTTP server (Python)
python3 -m http.server 8080 &
# Or: npx http-server -p 8080 &

# Step 4: Create config.yml
cat > ~/.cloudflared/config.yml << 'EOF'
tunnel: macksportreport-test
credentials-file: /Users/$(whoami)/.cloudflared/$(cloudflared tunnel list --name macksportreport-test --output json 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['id'])").json

ingress:
  - hostname: test.macksportreport.com
    service: http://localhost:8080
  - service: http_status:404
EOF

# Step 5: Create DNS record (CNAME to tunnel)
cloudflared tunnel route dns macksportreport-test test.macksportreport.com

# Step 6: Run the tunnel
cloudflared tunnel run macksportreport-test
```

### Lab 2: Verify Origin IP is Hidden
```bash
# While tunnel is running:
# Check what IP the world sees for test.macksportreport.com
nslookup test.macksportreport.com
# Returns: Cloudflare CNAME → Cloudflare IP (not your server IP)

# Verify the actual origin is not reachable directly
# From another machine:
curl -v --connect-timeout 5 http://YOUR_REAL_IP:8080
# Should fail if your firewall is properly configured to block inbound

# But via tunnel:
curl https://test.macksportreport.com
# Should succeed (via Cloudflare tunnel)
```

### Lab 3: Multiple Services from One Tunnel
```bash
# Start multiple local services
python3 -m http.server 8080 &  # Service 1
python3 -m http.server 8081 &  # Service 2

# Update config.yml
cat > ~/.cloudflared/config.yml << 'EOF'
tunnel: macksportreport-test
credentials-file: ~/.cloudflared/macksportreport-test.json

ingress:
  - hostname: staging.macksportreport.com
    service: http://localhost:8080
  - hostname: api.macksportreport.com
    service: http://localhost:8081
    originRequest:
      connectTimeout: 10s
  - service: http_status:404
EOF

# Route DNS for both
cloudflared tunnel route dns macksportreport-test staging.macksportreport.com
cloudflared tunnel route dns macksportreport-test api.macksportreport.com

# Restart tunnel to pick up config changes
cloudflared tunnel run macksportreport-test
```

### Lab 4: Install as System Service (Run on Boot)
```bash
# Linux (systemd)
sudo cloudflared service install

# macOS (launchd)
sudo cloudflared service install

# Check service status
sudo systemctl status cloudflared  # Linux
# launchctl list | grep cloudflare  # macOS

# View logs
sudo journalctl -u cloudflared -f  # Linux
```

### Lab 5: List and Manage Tunnels
```bash
# List all tunnels
cloudflared tunnel list

# Get tunnel details
cloudflared tunnel info macksportreport-test

# Delete DNS route
cloudflared tunnel route dns --delete macksportreport-test test.macksportreport.com

# Delete tunnel
cloudflared tunnel delete macksportreport-test

# Remotely-managed: list via API
curl "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/cfd_tunnel" \
  -H "Authorization: Bearer ${CF_API_TOKEN}"
```

### Lab 6: Pair Tunnel with Access Policy
```bash
# After creating the tunnel and Access policy (from Module 12.1),
# the combination means:
# 1. staging.macksportreport.com is exposed via Tunnel (no open ports on your server)
# 2. Access policy requires authentication before any request reaches your server
# 3. Your server only sees requests with valid Access JWTs

# Test: visit staging.macksportreport.com in browser
# Should redirect to Google/Okta login before showing any content
# After login, Cf-Access-Authenticated-User-Email header visible in server logs
```

---

## Demo Script (2 Minutes)

**Audience:** Developer or ops engineer managing a staging environment

**Opening (20 seconds):**
"How many inbound ports do you have open on your staging server right now? And who can reach it? Is it blocked by IP allowlist, or is port 443 open to the world?"

**Act 1 — Show the security benefit (30 seconds):**
"With Cloudflare Tunnel, you close all inbound ports. Everything. [Show server firewall rule: block all inbound.] The server initiates outbound connections to Cloudflare — like a VPN in reverse. Nobody can find your server's IP. Nobody can attack your exposed ports because there are none."

**Act 2 — Show the setup (40 seconds):**
"Setup is four commands. [Run lab commands.] `cloudflared tunnel login`. `cloudflared tunnel create my-app`. Edit a config.yml — hostname goes to localhost:3000. `cloudflared tunnel run`. Your app is now on the internet, behind Cloudflare, with no firewall rules changed. DNS is automatic."

**Act 3 — Show the Access integration (20 seconds):**
"And it's not public — Add an Access policy, and now this URL requires Google authentication before anyone can see your staging environment. Your app doesn't even know it's protected — Cloudflare handles auth before the request arrives."

**Close (10 seconds):**
"Tunnel is free. You pay for Access seats if you need authentication. What infrastructure costs could you eliminate by running your servers behind Tunnel instead of managing public IPs and SSL certs?"

---

## Competitive Context

| Feature | Cloudflare Tunnel | ngrok | Tailscale | HashiCorp Vault SSH | WireGuard self-hosted |
|---|---|---|---|---|---|
| **Outbound-only** | Yes | Yes | No (mesh) | No | No |
| **No open inbound ports** | Yes | Yes | No (mesh) | Yes (bastion) | No |
| **Origin IP hiding** | Yes | Yes | No | Yes | No |
| **Custom domain** | Yes (free with CF) | Yes ($) | Partial | No | No |
| **DDoS protection** | Yes (CF network) | No | No | No | No |
| **WAF integration** | Yes (native) | No | No | No | No |
| **Access/auth integration** | Yes (CF Access) | No native | Partial | Yes | Manual |
| **Kubernetes support** | Yes (Deployment) | Yes | Yes (sidecar) | Limited | Manual |
| **SSH/RDP through tunnel** | Yes | Yes | Yes (mesh) | Yes | Manual |
| **Private network routing** | Yes (IP ranges) | Limited | Yes (primary) | No | Yes |
| **Free tier** | Yes (unlimited traffic) | 1 tunnel, 40 req/min | Free (< 3 users) | Open source | Self-hosted cost |
| **Ops overhead** | Low (managed) | Low (managed) | Low (managed) | High | High |

**Key positioning:** Tunnel is unique in being part of a complete Zero Trust platform. ngrok is standalone. Tailscale is excellent for mesh networking. Tunnel's advantage is tight integration with Access, Gateway, WAF, and CF DDoS protection — all on the same network.

---

## Self-Check Questions

**Question 1:** Why is Cloudflare Tunnel described as "inverting the security model"? What does this mean in terms of firewall rules and origin IP exposure?

```
Your answer:




```

**Question 2:** A developer sets up cloudflared on their laptop to expose a localhost:3000 app for a demo. When they close their laptop lid, the tunnel goes down. How would you make the tunnel persistent and resilient for a production service on a server?

```
Your answer:




```

**Question 3:** Explain how Tunnel + Access together create a Zero Trust access model for an internal application. What would happen without Access?

```
Your answer:




```

**Question 4:** What is `cloudflared tunnel route ip` and how does it extend Tunnel beyond just web applications?

```
Your answer:




```

**Question 5:** How many connections does a healthy `cloudflared` daemon maintain, and to how many PoPs? Why does this architecture matter for availability?

```
Your answer:




```

---

## Sources

- [Cloudflare Tunnel Documentation](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
- [cloudflared Installation](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
- [Tunnel Configuration Reference](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/configure-tunnels/local-management/)
- [Private Network Routing via Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/private-net/)
- [Tunnel Kubernetes Integration](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/deploy-tunnels/deployment-guides/kubernetes/)
- [Tunnel + Access: Zero Trust Web App](https://developers.cloudflare.com/cloudflare-one/applications/configure-apps/self-hosted-apps/)
- [Cloudflare Blog: Announcing Cloudflare Tunnel](https://blog.cloudflare.com/argo-tunnel/)
- [Zero Trust Security Model (NIST 800-207)](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-207.pdf)
