# Module 10.11 — Cloudflare Queues
> Dashboard Location: Account Home → Workers & Pages → Queues | Estimated Time: 75 min | Lab Domain: macksportreport.com

---

## Theory (SE-Level)

Cloudflare Queues is a message queue service that enables guaranteed, at-least-once delivery of messages between Workers. Think of it as the glue that lets you decouple expensive background work from your real-time request handling.

**The core problem without queues:** A user submits a form. Your Worker tries to send an email, write to a database, call a third-party API, resize an image, and send a Slack notification — all within the 30-second CPU limit before returning a response. If any step fails, the whole thing fails. If there's a traffic spike, all of it backs up.

**With queues:** The Worker receives the form, enqueues a message, and immediately returns `202 Accepted` to the user. A separate consumer Worker processes the message in the background, retrying automatically on failure, at its own pace.

**Core concepts:**
- **Producer:** Worker that sends messages (the sender)
- **Consumer:** Worker that receives and processes messages (the handler)
- **Message:** The payload — string, JSON object, or ArrayBuffer
- **Batch:** Group of messages delivered to consumer at once (up to 10,000)
- **Acknowledgment:** Consumer tells Cloudflare the message was processed successfully; unacknowledged messages are retried
- **Dead-letter queue:** Destination for messages that fail after all retries

**Delivery guarantee:** At-least-once. A message is guaranteed to be delivered and processed at least one time. In rare failure scenarios, a message could be processed twice — consumers should be idempotent (safe to run twice with same result).

**Pricing:** $0.40 per million messages delivered. First 1 million per month free.

---

## Deep Dive (Architect-Level)

### Message Lifecycle

```
Producer Worker
   │
   │  env.MY_QUEUE.send({ event: "user_signup", userId: "123" })
   ▼
Cloudflare Queue (persistent storage)
   │
   │  [Cloudflare batches messages and delivers to consumer]
   │  [Retry on failure, exponential backoff]
   ▼
Consumer Worker (queue handler)
   │
   ├─ Process message (call email API, update DB, etc.)
   ├─ msg.ack()  → Message removed from queue ✓
   └─ msg.retry() → Message returned to queue for retry ↺
                  (or unhandled exception → automatic retry)
```

### Batching Behavior

Messages aren't delivered one at a time — they're batched:

| Setting | Default | Range |
|---|---|---|
| Max batch size | 10 messages | 1–10,000 |
| Max wait time | 5 seconds | 0–60 seconds |

Cloudflare waits until either the batch size is reached OR the wait time expires — whichever comes first. This means a consumer might receive 1 message (if the queue is quiet) or 100 messages (if there's a backlog).

**Why batching matters:** Processing 100 messages in one Worker invocation is dramatically more efficient than 100 separate invocations. Database inserts, API calls, and other I/O can be batched or parallelized within a single consumer invocation.

### Retry and Backoff

When a message fails (consumer throws, doesn't ack within timeout):
1. Message is returned to queue
2. Retry delay: exponential backoff (configurable, default: 30s, 60s, 120s...)
3. Max retries: configurable (default: 3)
4. After max retries: message moves to dead-letter queue (if configured) or dropped

```typescript
// Consumer with explicit retry control
export default {
  async queue(batch: MessageBatch<any>, env: Env): Promise<void> {
    for (const msg of batch.messages) {
      try {
        await processMessage(msg.body);
        msg.ack(); // Remove from queue
      } catch (error) {
        if (error.type === 'TRANSIENT') {
          msg.retry({ delaySeconds: 30 }); // Retry in 30 seconds
        } else {
          msg.ack(); // Permanent failure — log and discard
          await logFailure(msg.body, error);
        }
      }
    }
  }
};
```

### Pull Consumers

In addition to push (Worker handler), Queues supports pull: your application polls the queue on demand. Useful for:
- Non-Workers consumers (external application, Python script)
- Rate-controlled processing (pull only when ready for more work)
- Batch ETL jobs that run on a schedule

```bash
# Pull messages from queue via HTTP API
curl -X POST "https://api.cloudflare.com/client/v4/accounts/{id}/queues/{queue_id}/messages/pull" \
  -H "Authorization: Bearer $TOKEN" \
  --data '{"batch_size": 10}'

# Acknowledge pulled messages
curl -X POST "https://api.cloudflare.com/client/v4/accounts/{id}/queues/{queue_id}/messages/ack" \
  -H "Authorization: Bearer $TOKEN" \
  --data '{"acks": [{"lease_id": "..."}]}'
```

### Message Delay

Messages can be delayed before delivery:

```typescript
// Send message, don't process for 5 minutes
await env.MY_QUEUE.send(
  { type: "send_trial_expiry_email", userId: "123" },
  { delaySeconds: 300 }
);
```

This enables scheduled future work without needing Cron Triggers for every use case.

### Idempotency Pattern

Because Queues is at-least-once, consumer logic must be safe to run twice. The common pattern:

```typescript
async function processPayment(msg: { paymentId: string, amount: number }) {
  // Check if already processed
  const existing = await db.prepare(
    'SELECT id FROM processed_payments WHERE payment_id = ?'
  ).bind(msg.paymentId).first();

  if (existing) {
    return; // Already done, skip
  }

  // Process payment
  await stripeCharge(msg.amount);

  // Mark as processed
  await db.prepare(
    'INSERT INTO processed_payments (payment_id, processed_at) VALUES (?, ?)'
  ).bind(msg.paymentId, Date.now()).run();
}
```

---

## Dashboard Walkthrough

**Step 1: Create a Queue**
1. Navigate to Account Home → Workers & Pages → Queues
2. Click "Create queue"
3. Name: `macksportreport-jobs`
4. Region: Default (or specific region)
5. Click "Create queue"

**Step 2: Review Queue Details**
- Queue ID (needed for API calls)
- Created date
- Consumer count
- Message count (live metrics)

**Step 3: Monitor Queue Metrics**
1. Click on the queue
2. View: messages delivered, messages retried, consumer invocations, backlog size
3. Set up alerts if backlog grows unexpectedly

**Step 4: Bind Queue to a Worker**
1. Worker → Settings → Bindings
2. Add Queue producer binding: name=`MY_QUEUE`, queue=`macksportreport-jobs`
3. Or via wrangler.toml (see lab below)

---

## Hands-On Lab

### Prerequisites
```bash
npm install -g wrangler
wrangler login
export CF_ACCOUNT_ID="your-account-id"
export CF_API_TOKEN="your-cf-api-token"
```

### Lab 1: Create a Queue via Wrangler
```bash
# Create queue
wrangler queues create macksportreport-jobs

# List queues
wrangler queues list
```

### Lab 2: Full Producer + Consumer Setup
```typescript
// src/index.ts — Combined producer and consumer Worker
interface Env {
  JOB_QUEUE: Queue<JobMessage>;
}

interface JobMessage {
  type: 'send_email' | 'resize_image' | 'update_stats';
  userId: string;
  payload: Record<string, unknown>;
  createdAt: number;
}

export default {
  // HTTP handler — produces messages
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const body = await request.json() as { userId: string; email: string };

    // Enqueue background job
    await env.JOB_QUEUE.send({
      type: 'send_email',
      userId: body.userId,
      payload: { to: body.email, subject: 'Welcome to Mack Sport Report!' },
      createdAt: Date.now(),
    });

    // Return immediately — don't wait for email to send
    return Response.json({
      success: true,
      message: 'Registration received. Email queued.',
    }, { status: 202 });
  },

  // Queue consumer — processes messages
  async queue(batch: MessageBatch<JobMessage>, env: Env): Promise<void> {
    console.log(`Processing batch of ${batch.messages.length} messages`);

    for (const msg of batch.messages) {
      try {
        switch (msg.body.type) {
          case 'send_email':
            await sendEmail(msg.body.payload);
            break;
          case 'resize_image':
            await resizeImage(msg.body.payload);
            break;
          case 'update_stats':
            await updateStats(msg.body.userId);
            break;
          default:
            console.error('Unknown job type:', msg.body.type);
        }
        msg.ack();
      } catch (error) {
        console.error('Job failed:', error);
        msg.retry({ delaySeconds: 60 }); // Retry in 60 seconds
      }
    }
  }
} satisfies ExportedHandler<Env>;

async function sendEmail(payload: Record<string, unknown>): Promise<void> {
  // Call email service (Mailgun, SendGrid, Resend, etc.)
  console.log('Sending email to:', payload.to);
  // await mailgunClient.send({ to: payload.to, subject: payload.subject });
}

async function resizeImage(payload: Record<string, unknown>): Promise<void> {
  console.log('Resizing image:', payload.imageKey);
}

async function updateStats(userId: string): Promise<void> {
  console.log('Updating stats for user:', userId);
}
```

```toml
# wrangler.toml
name = "macksportreport-queue-demo"
main = "src/index.ts"
compatibility_date = "2024-11-01"

# Producer binding
[[queues.producers]]
binding = "JOB_QUEUE"
queue = "macksportreport-jobs"

# Consumer configuration
[[queues.consumers]]
queue = "macksportreport-jobs"
max_batch_size = 50
max_batch_timeout = 10
max_retries = 3
dead_letter_queue = "macksportreport-jobs-dlq"
```

```bash
# Deploy
wrangler deploy

# Test — send a job to the queue
curl -X POST https://macksportreport-queue-demo.your-subdomain.workers.dev/ \
  -H "Content-Type: application/json" \
  --data '{"userId": "user_123", "email": "test@macksportreport.com"}'
```

### Lab 3: Batch Processing with D1
```typescript
// Process 100 user stat updates in one batch — efficient DB writes
export default {
  async queue(batch: MessageBatch<{ userId: string; score: number }>, env: Env): Promise<void> {
    // Batch all DB writes instead of one at a time
    const statements = batch.messages.map(msg =>
      env.DB.prepare('UPDATE users SET score = score + ? WHERE id = ?')
        .bind(msg.body.score, msg.body.userId)
    );

    try {
      // Execute all statements in one transaction
      await env.DB.batch(statements);
      batch.ackAll(); // Ack all messages at once
    } catch (error) {
      batch.retryAll(); // Retry entire batch on failure
    }
  }
} satisfies ExportedHandler<Env>;
```

### Lab 4: Dead-Letter Queue Setup
```bash
# Create DLQ for failed messages
wrangler queues create macksportreport-jobs-dlq

# Add DLQ consumer to inspect failed messages
cat > dlq-handler.ts << 'EOF'
export default {
  async queue(batch: MessageBatch<any>, env: Env): Promise<void> {
    for (const msg of batch.messages) {
      // Log failed message for investigation
      console.error('Dead letter received:', JSON.stringify({
        body: msg.body,
        id: msg.id,
        timestamp: msg.timestamp,
      }));
      // Could write to R2 for long-term storage
      // Could send alert to Slack/PagerDuty
      msg.ack();
    }
  }
} satisfies ExportedHandler;
EOF
```

### Lab 5: Send a Message with Delay
```bash
# Via API
curl -X POST "https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/queues/macksportreport-jobs/messages" \
  -H "Authorization: Bearer ${CF_API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{
    "messages": [
      {
        "body": {"type": "send_trial_expiry", "userId": "user_456"},
        "delay_seconds": 300
      }
    ]
  }'
```

---

## Demo Script (2 Minutes)

**Audience:** Developer building a form submission or checkout flow

**Opening (20 seconds):**
"What happens in your app when a user submits a checkout — how many things do you try to do before returning a response? Email confirmation, inventory update, analytics event, fraud check. What if one of those calls takes 3 seconds or times out?"

**Act 1 — Show the problem (20 seconds):**
"Without a queue, you're doing all of this synchronously. Every downstream API is in the critical path. If SendGrid is slow, your checkout is slow. If it errors, your checkout errors."

**Act 2 — Show the solution (40 seconds):**
"With Queues, I send one message from the checkout handler — [show code] `env.CHECKOUT_QUEUE.send({orderId, userId, items})` — and I return 200 immediately. The user is done. The queue handles email, inventory, fraud check all in a separate Worker at its own pace. If the email API times out, the message retries automatically. The checkout is never affected."

**Act 3 — Show the cost (20 seconds):**
"This costs $0.40 per million messages. Your checkout processes 50,000 orders a month. That's 2 cents per month for the queue. The alternative is a Redis cluster."

**Close (20 seconds):**
"Who handles your background job infrastructure today? What are you running — Redis queues? A job server? How much time do you spend maintaining it? This is managed, globally distributed, and costs fractions of a cent."

---

## Competitive Context

| Feature | Cloudflare Queues | AWS SQS | Google Cloud Tasks | Redis Queue (self-hosted) | Inngest |
|---|---|---|---|---|---|
| **Integration** | Native Workers binding | HTTP API / Lambda trigger | HTTP API | Redis client library | HTTP webhooks |
| **Delivery guarantee** | At-least-once | At-least-once | At-least-once | Depends on config | At-least-once |
| **Max message size** | 128 KB | 256 KB | 1 MB | Configurable | Configurable |
| **Max retention** | 4 days | 14 days | 30 days | Unlimited (Redis) | 7 days |
| **Delay messages** | Yes (up to 12h) | Yes (up to 15 min) | Yes (up to 30 days) | Yes | Yes |
| **Dead-letter queue** | Yes | Yes | No (native) | Manual | Yes |
| **Pull consumers** | Yes | Yes (primary mode) | No | Yes | No |
| **Batch processing** | Yes (up to 10K/batch) | Yes (up to 10) | No | Yes | Limited |
| **Pricing** | $0.40/million | $0.40/million | $0.40/million | Server cost + ops | $3/month+ |
| **Ops overhead** | Zero | Low (managed) | Low (managed) | High (self-managed) | Zero |
| **Latency** | Low (same edge) | 1-10ms | Variable | Very low | Variable |

**Key positioning:** Queues is the only message queue where producers and consumers are on the same global edge as your HTTP handlers. There's no cross-region hop — your Worker enqueues a message and the consumer runs within Cloudflare's infrastructure. For latency-sensitive pipelines, this matters.

---

## Self-Check Questions

**Question 1:** Explain "at-least-once delivery" and describe a real scenario where a message could be processed twice. Write a code pattern (idempotency key) to handle this safely.

```
Your answer:




```

**Question 2:** A customer's consumer Worker is slow — it takes 10 seconds to process each message. Their queue has a backlog of 50,000 messages. What settings would you tune to increase throughput?

```
Your answer:




```

**Question 3:** Describe the difference between `msg.ack()`, `msg.retry()`, and `batch.ackAll()`. When would you use each?

```
Your answer:




```

**Question 4:** A customer wants to send a welcome email 24 hours after a user signs up, not immediately. How would you implement this using Queues?

```
Your answer:




```

**Question 5:** What is a dead-letter queue and why do you need one? Describe what you'd do with messages that land in the DLQ.

```
Your answer:




```

---

## Sources

- [Cloudflare Queues Documentation](https://developers.cloudflare.com/queues/)
- [Queues Configuration Reference](https://developers.cloudflare.com/queues/configuration/)
- [Queues Message Batching](https://developers.cloudflare.com/queues/configuration/batching-retries/)
- [Queues Pull Consumers](https://developers.cloudflare.com/queues/configuration/pull-consumers/)
- [Queues Pricing](https://developers.cloudflare.com/queues/platform/pricing/)
- [AWS SQS Pricing](https://aws.amazon.com/sqs/pricing/)
- [Cloudflare Blog: Cloudflare Queues GA](https://blog.cloudflare.com/cloudflare-queues-open-beta/)
- [Queue-based load leveling pattern](https://docs.microsoft.com/en-us/azure/architecture/patterns/queue-based-load-leveling)
