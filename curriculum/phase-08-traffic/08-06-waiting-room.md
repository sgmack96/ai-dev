# Module 8.6 — Waiting Room
> Dashboard Location: macksportreport.com → Traffic → Waiting Room
> Estimated Time: 60 minutes
> Lab Domain: macksportreport.com

---

## Theory (SE-Level)

### What Is a Waiting Room?

A Waiting Room is a virtual queue that controls how many users can access a specific URL on your site simultaneously. When the number of active users reaches your configured maximum, new visitors are held in a waiting room page that shows them their queue position and estimated wait time. As existing users leave, new users are automatically admitted.

**The analogy:** Think of a theme park ride with a maximum capacity. The waiting room is the queue — organized, transparent to the visitor, and self-managing.

### The Problem It Solves

**Without a waiting room:**
- Ticket drop for macksportreport.com's premium content subscription happens at 10 AM
- 50,000 users hit the page simultaneously
- Your origin server, sized for 5,000 concurrent users, buckles under the load
- Site becomes extremely slow or crashes
- ALL users get a bad experience simultaneously
- Revenue is lost, support tickets flood in

**With a waiting room:**
- 50,000 users hit the page simultaneously
- 5,000 users are admitted immediately
- 45,000 users see a professional waiting room: "You're #14,532 in line. Estimated wait: 8 minutes."
- As users complete checkout and leave, the next user in line is admitted
- Origin server never sees more than 5,000 concurrent users
- Site remains fast and available for admitted users
- Users know what's happening and don't feel helpless

### Real-World Use Cases

- **Sports subscription launches:** Limited access sports content drops
- **Ticket sales:** Concert, sports event tickets go on sale
- **Product launches:** New product/merchandise drop (sneakers, consoles)
- **Government services:** Vaccine registration portals, benefit applications
- **Flash sales:** Limited inventory time-limited sales
- **Training enrollments:** Course registration with limited seats

### How It Works Technically

1. **Active session counting:** Cloudflare tracks active sessions using a **cookie** (set on user admission). A session is "active" for a configurable duration (e.g., 5 minutes after last activity).

2. **Threshold evaluation:** On each request to the waiting room URL, Cloudflare checks the current active session count against your configured maximum.

3. **Admission or queue:** If under the limit, user is admitted (cookie set, request passes through). If at or above the limit, user receives the waiting room HTML page.

4. **Queue position and wait time:** Cloudflare estimates queue position and wait time based on:
   - User's position in the queue (FIFO order by default)
   - Current throughput rate (users admitted per minute)
   - Average session duration

5. **Auto-advancement:** The waiting room page auto-refreshes every `refresh_interval_seconds`. When a user's turn arrives, the page redirects them to the target URL automatically.

6. **Session expiration:** If an admitted user is idle for longer than the session duration, their session expires, their cookie becomes invalid, and they may be queued again if the site is still at capacity.

---

## Deep Dive (Architect-Level)

### Waiting Room Configuration Parameters

```json
{
  "name": "premium-launch-queue",
  "description": "Premium subscription launch queue",
  "host": "macksportreport.com",
  "path": "/premium",
  "total_active_users": 5000,
  "new_users_per_minute": 200,
  "session_duration": 5,
  "cookie_name": "CF_WR_PREMIUM",
  "enabled": true,
  "queue_all": false,
  "disable_session_renewal": false,
  "json_response_enabled": false,
  "queueing_method": "fifo",
  "queueing_status_code": 200
}
```

**`total_active_users`:**
Maximum concurrent active sessions to allow through. Set this to what your origin can comfortably handle, not the peak you're expecting. Tune it with load testing.

**`new_users_per_minute`:**
Rate at which new users are admitted from the queue even if `total_active_users` is not reached. This prevents thundering herd — if 10,000 users are waiting and 200 slots open up simultaneously, you don't want all 200 admitted at once. Instead, admit them at a controlled rate (e.g., 200 per minute = ~3 per second).

**`session_duration` (minutes):**
How long an admitted session stays "active" after the last request. If a user is admitted and then walks away from their computer for 10 minutes (and `session_duration = 5`), their slot is freed for the next person in queue.

**`queue_all`:**
If `true`, ALL incoming users are queued regardless of current active user count. Use this to pre-queue users before an event starts (e.g., queue everyone from 9:45 AM for a 10:00 AM launch). Combined with **Waiting Room Event** for scheduled releases.

**`queueing_method`:**
- `fifo` (first-in-first-out): Users are admitted in order of arrival
- `random`: Users are randomly selected from the queue

**`json_response_enabled`:**
If `true`, Cloudflare returns JSON instead of HTML when a user is queued. Use this for Single Page Applications (SPAs), mobile apps, or custom waiting room UIs that parse the JSON and render their own experience.

JSON response format:
```json
{
  "cfWaitingRoom": {
    "inWaitingRoom": true,
    "waitTime": 12,
    "waitTimeKnown": true,
    "waitTimeFormatted": "12 minutes",
    "positionInQueue": 3847,
    "queueIsFull": false,
    "refreshIntervalSeconds": 20
  }
}
```

### Custom Waiting Room Page

You can fully customize the HTML that waiting users see. Cloudflare provides template variables:

```html
<!DOCTYPE html>
<html>
<head>
  <title>{{waitTime}} minute wait — Mack's Sport Report</title>
  <meta http-equiv="refresh" content="{{refreshIntervalSeconds}}">
</head>
<body>
  <div class="waiting-room">
    <h1>You're in line!</h1>
    
    {{#if waitTimeKnown}}
    <p>Estimated wait: <strong>{{waitTime}} minutes</strong></p>
    {{else}}
    <p>Calculating wait time...</p>
    {{/if}}
    
    {{#if positionInQueue}}
    <p>Your position: <strong>#{{positionInQueue}}</strong></p>
    {{/if}}
    
    <p>Queue ID: <code>{{queueId}}</code></p>
    
    <p>Don't close this tab — you'll lose your place in line.</p>
    
    {{#if refreshIntervalSeconds}}
    <p><small>This page will automatically refresh every {{refreshIntervalSeconds}} seconds.</small></p>
    {{/if}}
  </div>
</body>
</html>
```

**Available template variables:**
| Variable | Type | Description |
|----------|------|-------------|
| `{{waitTime}}` | number | Estimated wait in minutes |
| `{{waitTimeKnown}}` | boolean | Whether wait time can be estimated |
| `{{waitTimeFormatted}}` | string | Human-formatted wait time |
| `{{positionInQueue}}` | number | User's position in queue |
| `{{queueId}}` | string | Unique identifier for this queue session |
| `{{queueIsFull}}` | boolean | Whether queue has reached maximum capacity |
| `{{refreshIntervalSeconds}}` | number | Recommended refresh interval |

### Waiting Room Events

A Waiting Room Event schedules a specific waiting room behavior for a time window:

```json
{
  "name": "premium-launch-10am",
  "event_start_time": "2025-01-15T10:00:00Z",
  "event_end_time": "2025-01-15T12:00:00Z",
  "prequeue_start_time": "2025-01-15T09:45:00Z",
  "description": "Premium subscription launch at 10 AM UTC",
  "total_active_users": 1000,
  "new_users_per_minute": 100,
  "queue_all": true,
  "shuffle_at_event_start": true,
  "disable_session_renewal": false,
  "suspended": false
}
```

**`prequeue_start_time`:** 
Start holding everyone in the waiting room 15 minutes before the event. Users who arrive early are queued (no one gets through early). At `event_start_time`, the queue starts admitting users.

**`shuffle_at_event_start`:**
When the event starts, randomize queue order instead of giving advantage to whoever arrived first. Common for ticket sales where "camping" the page gives unfair advantage.

**`total_active_users` override:**
The event can have different limits than the base waiting room. Use this to ramp capacity: base room allows 500, event allows 1000 (you provisioned extra servers for the launch).

### Waiting Room Analytics

Dashboard → Waiting Room → [select a room] → Analytics:

- **Queue length over time:** How many users were in queue at each point
- **Wait time over time:** Average/median wait time trend
- **Users admitted:** Rate of admission
- **Users turned away:** If `queueIsFull` (queue has a configurable max size), how many were turned away
- **Session duration:** Distribution of how long admitted users stay

Use this data to:
1. Retroactively tune `total_active_users` and `new_users_per_minute` for the next event
2. Validate that origin capacity matched the configured limit
3. Show stakeholders how many users were protected from seeing a crashed site

### Waiting Room vs DIY: The Build Cost

If you tried to build this yourself:

```
Required components:
- Session store (Redis cluster for distributed counting): $200-500/month
- Queue service (SQS or custom): $50-100/month + ops
- Waiting room web server (separate EC2/Lambda): $100-300/month
- Load testing and capacity planning: 40+ engineer hours
- Queue position and ETA calculation logic: 20+ engineer hours
- Cookie management and session tracking: 10+ engineer hours
- Custom UI design: 20+ engineer hours
- Integration and testing: 20+ engineer hours
- Maintenance and operations: ongoing

Total: $350-900/month infrastructure + 110+ engineer hours (one-time)
```

Cloudflare Waiting Room: included in Enterprise or available as an add-on. Configured in minutes.

---

## Dashboard Walkthrough

**Navigation:** macksportreport.com → Traffic → Waiting Room

### Create a Waiting Room

1. Click **Create Waiting Room**
2. **Step 1 — Settings:**
   - Name: `premium-launch-queue`
   - Hostname: `macksportreport.com`
   - Path: `/premium` (or `/` for site-wide)
   - Total active users: `5000`
   - New users per minute: `200`
   - Session duration: `5` minutes
   - Cookie name: `CF_WR`
3. **Step 2 — Customization:**
   - Choose: Default template or Custom HTML
   - If custom: paste your HTML template
   - Preview the waiting room appearance
4. **Step 3 — Review and Enable:**
   - Review configuration summary
   - Toggle: Enabled
   - Click **Deploy**

### Create a Waiting Room Event

1. Navigate to your waiting room → **Events** tab
2. Click **Create Event**
3. Configure:
   - Event name: `10am-launch`
   - Start time: `2025-01-15T10:00:00Z`
   - End time: `2025-01-15T12:00:00Z`
   - Pre-queue start: `2025-01-15T09:45:00Z`
   - Queue all: On (hold everyone before 10 AM)
   - Shuffle at start: On
4. Click **Save**

---

## Hands-On Lab

### Lab 1: Create a Waiting Room via API

```bash
# Create a waiting room
curl -s -X POST "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/waiting_rooms" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{
    "name": "premium-launch-queue",
    "description": "Premium subscription launch waiting room",
    "host": "macksportreport.com",
    "path": "/premium",
    "total_active_users": 500,
    "new_users_per_minute": 50,
    "session_duration": 5,
    "cookie_name": "CF_WR_PREMIUM",
    "enabled": true,
    "queue_all": false,
    "queueing_method": "fifo"
  }' | jq '.result | {id, name, enabled, total_active_users}'

# Save the waiting room ID
WR_ID=$(curl -s "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/waiting_rooms" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" | jq -r '.result[0].id')
echo "Waiting Room ID: $WR_ID"
```

### Lab 2: Create a Custom Waiting Room Page

```bash
# Update waiting room with custom HTML
cat > custom_waiting_room.html << 'HTMLEOF'
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{waitTime}} min wait - Mack's Sport Report Premium</title>
  <meta http-equiv="refresh" content="{{refreshIntervalSeconds}}">
  <style>
    body { font-family: system-ui, sans-serif; background: #0f172a; color: #f8fafc;
           display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
    .card { background: #1e293b; padding: 2rem; border-radius: 1rem;
            max-width: 480px; width: 90%; text-align: center; }
    .logo { font-size: 2rem; margin-bottom: 1rem; }
    h1 { color: #f97316; margin: 0 0 0.5rem; }
    .wait-time { font-size: 3rem; font-weight: bold; color: #f97316; margin: 1rem 0; }
    .position { color: #94a3b8; margin-bottom: 1rem; }
    .note { font-size: 0.85rem; color: #64748b; margin-top: 1.5rem; }
    .spinner { width: 40px; height: 40px; border: 3px solid #334155;
               border-top-color: #f97316; border-radius: 50%;
               animation: spin 1s linear infinite; margin: 1rem auto; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">🏆</div>
    <h1>You're in the queue!</h1>
    <div class="spinner"></div>
    {{#if waitTimeKnown}}
    <div class="wait-time">~{{waitTime}} min</div>
    {{else}}
    <div class="wait-time">Estimating...</div>
    {{/if}}
    {{#if positionInQueue}}
    <p class="position">Position: #{{positionInQueue}}</p>
    {{/if}}
    <p>Keep this tab open — we'll let you in automatically when your turn comes.</p>
    <p class="note">This page refreshes every {{refreshIntervalSeconds}} seconds.<br>
    Queue ID: {{queueId}}</p>
  </div>
</body>
</html>
HTMLEOF

# URL-encode and update the waiting room with custom HTML
CUSTOM_HTML=$(cat custom_waiting_room.html | python3 -c "import sys, json; print(json.dumps(sys.stdin.read()))")

curl -s -X PATCH "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/waiting_rooms/${WR_ID}" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data "{\"custom_page_html\": ${CUSTOM_HTML}}" | jq '.success'
```

### Lab 3: Create a Waiting Room Event

```bash
# Create an event for a scheduled launch
curl -s -X POST "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/waiting_rooms/${WR_ID}/events" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{
    "name": "premium-10am-launch",
    "description": "Premium subscription opens at 10 AM UTC",
    "event_start_time": "2025-01-15T10:00:00Z",
    "event_end_time": "2025-01-15T12:00:00Z",
    "prequeue_start_time": "2025-01-15T09:45:00Z",
    "total_active_users": 1000,
    "new_users_per_minute": 100,
    "queue_all": true,
    "shuffle_at_event_start": true,
    "suspended": false
  }' | jq '.result | {id, name, event_start_time, queue_all, shuffle_at_event_start}'
```

### Lab 4: Test JSON Response Mode

```bash
# Enable JSON response mode
curl -s -X PATCH "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/waiting_rooms/${WR_ID}" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{"json_response_enabled": true}' | jq '.success'

# Test: request the queued URL with JSON accept header
curl -s -H "Accept: application/json" \
  "https://macksportreport.com/premium" | jq '.cfWaitingRoom // "User admitted (not queued)"'

# Test: simulate a queued user by setting queue_all temporarily
curl -s -X PATCH "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/waiting_rooms/${WR_ID}" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{"queue_all": true}' | jq '.success'

# Now request the URL — should show waiting room data
curl -s "https://macksportreport.com/premium" | jq '.'

# Reset queue_all
curl -s -X PATCH "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/waiting_rooms/${WR_ID}" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{"queue_all": false}' | jq '.success'
```

### Lab 5: Check Waiting Room Status

```bash
# Get current waiting room status
curl -s "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/waiting_rooms/${WR_ID}" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" | \
  jq '.result | {name, enabled, total_active_users, new_users_per_minute, session_duration, path}'

# List all waiting rooms in the zone
curl -s "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/waiting_rooms" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" | \
  jq '.result[] | {name, enabled, host, path, total_active_users}'
```

---

## Demo Script (2 Minutes)

**Audience:** E-commerce CTO, event organizer, government IT director

**Opening:**
> "You're launching your premium sports picks package at 10 AM on Super Bowl weekend. Your server handles 5,000 users at a time. 80,000 sports fans are going to try to buy at 10:00:00 AM. Without a waiting room, 75,000 of them see a crash. With this, they see a queue."

**Show:**
1. Traffic → Waiting Room → show the premium-launch-queue config
2. Custom page preview: "This is what waiting users see — branded, estimated wait time, queue position, auto-refresh"
3. Show the Event configuration: "Queue starts at 9:45 AM, nobody gets in early. At 10:00, the queue shuffles — no advantage for camping the page."
4. Analytics: "After the event: we see peak queue was 62,000 users, average wait time 14 minutes, zero crashes."

**Closer:**
> "The difference between a successful launch and a PR disaster is this configuration, enabled the night before. Every admitted user had a good experience. Every queued user knew exactly what was happening. Zero server overload."

---

## Competitive Context

| Feature | Cloudflare Waiting Room | Queue-it | Akamai Queue Manager | Build It Yourself |
|---------|------------------------|---------|---------------------|------------------|
| Setup time | Minutes | Hours-Days | Days | Weeks-Months |
| Custom branding | Yes | Yes | Yes | Yes |
| FIFO + Random | Yes | Yes | Yes | Custom |
| Pre-queue events | Yes | Yes | Yes | Custom |
| JSON mode (SPA) | Yes | Yes | Limited | Yes |
| Analytics | Yes | Yes (detailed) | Yes | Custom |
| Scale | CF network (millions) | Millions | Millions | Your infra |
| Already in CF platform | Yes | No | No | No |
| Price | Add-on | $$$$ | $$$$ | Eng cost + infra |

**When Cloudflare wins:** Already using Cloudflare (single vendor), quick setup needed, reasonable scale requirements (millions of queued users).

**When Queue-it wins:** Need very advanced waiting room features (token-based admission, virtual lobby, integration with ticketing systems), extreme customization, dedicated account team for mission-critical events.

---

## Self-Check Questions

**Q1: What is `new_users_per_minute` and why is it important to set it, even when `total_active_users` slots are available?**

```
Your answer:




```

**Q2: A customer wants to launch ticket sales for a concert at exactly 12:00 PM UTC, hold everyone in the queue from 11:45 AM, and give all early arrivals an equal chance at 12:00. What configuration would you set up?**

```
Your answer:




```

**Q3: A mobile app (SPA/React Native) needs to integrate with the waiting room. What waiting room feature should be enabled and what does the response look like?**

```
Your answer:




```

**Q4: What happens to a user's queue position if they close the browser tab while waiting?**

```
Your answer:




```

**Q5: A customer's waiting room is configured for 1,000 `total_active_users` and 5-minute `session_duration`. If 1,000 users are admitted and they all remain active, how long until the first queue slot opens up (best case)?**

```
Your answer:




```

---

## Sources

- [Cloudflare Waiting Room Documentation](https://developers.cloudflare.com/waiting-room/)
- [Waiting Room API Reference](https://developers.cloudflare.com/api/operations/waiting-room-list-waiting-rooms)
- [Waiting Room Events](https://developers.cloudflare.com/waiting-room/how-to/create-waiting-room-event/)
- [Custom Waiting Room HTML Templates](https://developers.cloudflare.com/waiting-room/how-to/customize-waiting-room/)
- [JSON Response Mode](https://developers.cloudflare.com/waiting-room/how-to/json-response/)
- [Waiting Room Analytics](https://developers.cloudflare.com/waiting-room/additional-options/waiting-room-analytics/)
- [Queueing Methods](https://developers.cloudflare.com/waiting-room/reference/queueing-methods/)
- [Cloudflare Blog: Waiting Room Launch](https://blog.cloudflare.com/cloudflare-waiting-room/)
