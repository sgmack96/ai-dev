/**
 * src/ui.ts
 *
 * Returns the full HTML/CSS/JS for the SE Intel chat UI.
 * Served at GET / by the Worker.
 *
 * Design: dark terminal aesthetic, dual-panel chat (Account Intel | Enablement),
 * role switcher at the top, tool badges per response, latency display.
 *
 * All API calls go to /dev/token (to get a JWT) and then /api/v1/account
 * or /api/v1/enablement. No external dependencies — pure vanilla JS.
 */

export function getUIHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>SE Intel — Revenue Intelligence</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg:        #0d1117;
      --surface:   #161b22;
      --border:    #30363d;
      --text:      #e6edf3;
      --muted:     #7d8590;
      --accent:    #f6821f;
      --accent-dim:#7c3a0a;
      --green:     #3fb950;
      --blue:      #58a6ff;
      --purple:    #bc8cff;
      --yellow:    #e3b341;
      --red:       #f85149;
      --radius:    6px;
      --font:      'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
    }

    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    /* ── Header ── */
    header {
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      padding: 12px 20px;
      display: flex;
      align-items: center;
      gap: 16px;
      flex-shrink: 0;
    }

    .logo {
      font-weight: 700;
      font-size: 15px;
      letter-spacing: 0.02em;
      color: var(--accent);
    }
    .logo span { color: var(--text); }

    .header-right {
      margin-left: auto;
      display: flex;
      align-items: center;
      gap: 12px;
    }

    label {
      font-size: 12px;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }

    select, input[type="text"] {
      background: var(--bg);
      border: 1px solid var(--border);
      color: var(--text);
      border-radius: var(--radius);
      padding: 5px 10px;
      font-size: 13px;
      outline: none;
      cursor: pointer;
    }
    select:focus, input[type="text"]:focus {
      border-color: var(--accent);
    }

    #user-name-input {
      width: 140px;
    }

    .status-dot {
      width: 8px; height: 8px;
      border-radius: 50%;
      background: var(--muted);
      flex-shrink: 0;
    }
    .status-dot.connected { background: var(--green); }

    /* ── Panels ── */
    .panels {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0;
      flex: 1;
      min-height: 0;
    }

    .panel {
      display: flex;
      flex-direction: column;
      border-right: 1px solid var(--border);
      min-height: 0;
    }
    .panel:last-child { border-right: none; }

    .panel-header {
      padding: 10px 16px;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
    }
    .panel-title {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--muted);
    }
    .panel-badge {
      font-size: 10px;
      padding: 2px 7px;
      border-radius: 10px;
      font-weight: 600;
      letter-spacing: 0.04em;
    }
    .badge-account { background: var(--accent-dim); color: var(--accent); }
    .badge-enablement { background: #1a2d4a; color: var(--blue); }

    /* ── Messages ── */
    .messages {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 14px;
      min-height: 0;
    }
    .messages::-webkit-scrollbar { width: 4px; }
    .messages::-webkit-scrollbar-track { background: transparent; }
    .messages::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }

    .msg {
      display: flex;
      flex-direction: column;
      gap: 4px;
      max-width: 100%;
    }

    .msg-meta {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 11px;
      color: var(--muted);
    }
    .msg-role {
      font-weight: 600;
      font-family: var(--font);
    }
    .msg-role.user  { color: var(--accent); }
    .msg-role.agent { color: var(--blue); }
    .msg-role.system { color: var(--purple); }

    .msg-body {
      font-size: 13.5px;
      line-height: 1.6;
      color: var(--text);
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 10px 13px;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .msg.user .msg-body {
      background: #1a1f28;
      border-color: #2d333b;
    }
    .msg.error .msg-body {
      border-color: var(--red);
      color: var(--red);
    }

    .msg-footer {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }

    .tool-badge {
      font-size: 10px;
      font-family: var(--font);
      padding: 2px 6px;
      border-radius: 4px;
      background: #1a2d1a;
      color: var(--green);
      border: 1px solid #2d4a2d;
    }

    .latency-badge {
      font-size: 10px;
      font-family: var(--font);
      color: var(--muted);
    }

    /* ── Thinking indicator ── */
    .thinking .msg-body {
      color: var(--muted);
      font-style: italic;
    }
    .dots { display: inline-block; }
    .dots::after {
      content: '';
      animation: dots 1.2s steps(4, end) infinite;
    }
    @keyframes dots {
      0%   { content: ''; }
      25%  { content: '.'; }
      50%  { content: '..'; }
      75%  { content: '...'; }
    }

    /* ── Input area ── */
    .input-area {
      padding: 12px 16px;
      background: var(--surface);
      border-top: 1px solid var(--border);
      display: flex;
      gap: 8px;
      flex-shrink: 0;
    }

    .input-area textarea {
      flex: 1;
      background: var(--bg);
      border: 1px solid var(--border);
      color: var(--text);
      border-radius: var(--radius);
      padding: 8px 12px;
      font-size: 13px;
      font-family: inherit;
      resize: none;
      height: 60px;
      outline: none;
      line-height: 1.5;
    }
    .input-area textarea:focus { border-color: var(--accent); }
    .input-area textarea::placeholder { color: var(--muted); }

    .send-btn {
      background: var(--accent);
      color: white;
      border: none;
      border-radius: var(--radius);
      padding: 0 16px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      flex-shrink: 0;
      transition: opacity 0.15s;
    }
    .send-btn:hover { opacity: 0.85; }
    .send-btn:disabled { opacity: 0.4; cursor: not-allowed; }

    /* ── Welcome / empty state ── */
    .empty-state {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 24px;
      text-align: center;
    }
    .empty-icon { font-size: 28px; opacity: 0.4; }
    .empty-title { font-size: 13px; font-weight: 600; color: var(--muted); }
    .empty-hints { font-size: 12px; color: var(--muted); opacity: 0.7; }

    .hint-chips {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-top: 10px;
      width: 100%;
      max-width: 320px;
    }
    .hint-chip {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 7px 12px;
      font-size: 12px;
      color: var(--muted);
      cursor: pointer;
      text-align: left;
      transition: border-color 0.15s, color 0.15s;
    }
    .hint-chip:hover { border-color: var(--accent); color: var(--text); }

    /* ── Toast ── */
    #toast {
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%) translateY(60px);
      background: var(--surface);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 10px 18px;
      border-radius: var(--radius);
      font-size: 13px;
      transition: transform 0.2s;
      z-index: 100;
      pointer-events: none;
    }
    #toast.show { transform: translateX(-50%) translateY(0); }
    #toast.error { border-color: var(--red); color: var(--red); }

    /* ── Memory bar ── */
    #memory-bar {
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      padding: 6px 20px;
      display: flex;
      align-items: center;
      gap: 10px;
      flex-shrink: 0;
      min-height: 32px;
      overflow: hidden;
    }
    .memory-label {
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--purple);
      white-space: nowrap;
      flex-shrink: 0;
    }
    .memory-facts {
      display: flex;
      gap: 6px;
      flex-wrap: nowrap;
      overflow: hidden;
      align-items: center;
    }
    .memory-fact {
      font-size: 11px;
      color: var(--muted);
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 2px 8px;
      white-space: nowrap;
      max-width: 240px;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .memory-empty {
      font-size: 11px;
      color: var(--muted);
      font-style: italic;
      opacity: 0.6;
    }
    .memory-count {
      font-size: 10px;
      color: var(--purple);
      font-family: var(--font);
      flex-shrink: 0;
      margin-left: 2px;
    }

    /* ── Responsive ── */
    @media (max-width: 700px) {
      .panels { grid-template-columns: 1fr; grid-template-rows: 1fr 1fr; }
      .panel { border-right: none; border-bottom: 1px solid var(--border); }
      .panel:last-child { border-bottom: none; }
    }
  </style>
</head>
<body>

<header>
  <div class="logo">SE<span> Intel</span></div>
  <div style="font-size:12px;color:var(--muted)">Revenue Intelligence Platform</div>

  <div class="header-right">
    <label for="user-name-input">Name</label>
    <input type="text" id="user-name-input" value="Alex Rivera" placeholder="Your name" />

    <label for="role-select">Role</label>
    <select id="role-select">
      <option value="ae">AE</option>
      <option value="se" selected>SE</option>
      <option value="csm">CSM</option>
      <option value="tam">TAM</option>
      <option value="sales_manager">Manager</option>
    </select>

    <div class="status-dot" id="status-dot"></div>
  </div>
</header>

<!-- Memory bar — shows what the agent remembers about this user -->
<div id="memory-bar">
  <span class="memory-label">Memory</span>
  <div class="memory-facts" id="memory-facts">
    <span class="memory-empty">No facts stored yet — start chatting</span>
  </div>
  <span class="memory-count" id="memory-count" style="display:none"></span>
</div>

<div class="panels">
  <!-- Account Intel -->
  <div class="panel" id="panel-account">
    <div class="panel-header">
      <span class="panel-title">Account Intel</span>
      <span class="panel-badge badge-account">Pre-call Research</span>
    </div>
    <div class="messages" id="msgs-account">
      <div class="empty-state" id="empty-account">
        <div class="empty-icon">🔍</div>
        <div class="empty-title">Account Intelligence</div>
        <div class="empty-hints">Research prospects, map tech stacks,<br>surface Cloudflare opportunities</div>
        <div class="hint-chips" id="hints-account"></div>
      </div>
    </div>
    <div class="input-area">
      <textarea id="input-account" placeholder="Research Stripe, map their stack, get deal angles…" rows="2"></textarea>
      <button class="send-btn" id="send-account" onclick="send('account')">Send</button>
    </div>
  </div>

  <!-- Enablement -->
  <div class="panel" id="panel-enablement">
    <div class="panel-header">
      <span class="panel-title">Enablement</span>
      <span class="panel-badge badge-enablement">Sales Coaching</span>
    </div>
    <div class="messages" id="msgs-enablement">
      <div class="empty-state" id="empty-enablement">
        <div class="empty-icon">💡</div>
        <div class="empty-title">Sales Enablement</div>
        <div class="empty-hints">Product Q&amp;A, objection handling,<br>demo prep, competitive positioning</div>
        <div class="hint-chips" id="hints-enablement"></div>
      </div>
    </div>
    <div class="input-area">
      <textarea id="input-enablement" placeholder="How does Workers compare to Lambda? Handle pricing objections…" rows="2"></textarea>
      <button class="send-btn" id="send-enablement" onclick="send('enablement')">Send</button>
    </div>
  </div>
</div>

<div id="toast"></div>

<script>
  // ── State ──────────────────────────────────────────────────────────────────
  let token = null;
  const threads = { account: null, enablement: null };

  const HINTS = {
    account: [
      'Research Stripe — tech stack and Cloudflare opportunity',
      'They use AWS Lambda, Fastly, and Auth0. What is our angle?',
      'Latest news on Notion — I have a call tomorrow',
      'Write 5 discovery questions for a SaaS startup on Azure',
    ],
    enablement: [
      'How does Cloudflare Workers compare to AWS Lambda?',
      'Top 3 objections to Cloudflare WAF and how to handle them',
      'Help me prep a Zero Trust Access demo for a 200-person company',
      'What is the migration path from Fastly to Cloudflare CDN?',
    ],
  };

  // Manager-only hints injected when role = sales_manager
  const MANAGER_HINTS = {
    enablement: [
      'A deal is stalled at $250K — discount approval process?',
      'How do I build a champion when I am stuck at mid-level?',
      'Executive sponsorship playbook for a stalled deal',
    ],
  };

  // ── Memory ────────────────────────────────────────────────────────────────
  // Fetch stored facts from /api/v1/memory and render them in the memory bar.
  // Called once on load (after getting a token) and after each response.
  async function loadMemory() {
    try {
      const tok = await getToken();
      const resp = await fetch('/api/v1/memory', {
        headers: { 'Authorization': 'Bearer ' + tok },
      });
      if (!resp.ok) return;
      const data = await resp.json();
      renderMemory(data.facts || []);
    } catch {
      // Non-fatal — memory display is best-effort
    }
  }

  function renderMemory(facts) {
    const container = document.getElementById('memory-facts');
    const countEl   = document.getElementById('memory-count');

    if (!facts || facts.length === 0) {
      container.innerHTML = '<span class="memory-empty">No facts stored yet — start chatting</span>';
      countEl.style.display = 'none';
      return;
    }

    // Show most recent facts first, cap at 4 visible in the bar
    const visible = facts.slice(0, 4);
    const hidden  = facts.length - visible.length;

    container.innerHTML = visible
      .map(f => '<span class="memory-fact" title="' + escHtmlAttr(f.content) + '">' + escHtml(f.content) + '</span>')
      .join('');

    if (hidden > 0) {
      countEl.textContent = '+' + hidden + ' more';
      countEl.style.display = 'inline';
    } else {
      countEl.style.display = 'none';
    }
  }

  function escHtmlAttr(s) {
    return s.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    renderHints();
    document.getElementById('role-select').addEventListener('change', () => {
      token = null; // invalidate token on role change
      renderHints();
      setStatus(false);
      // Clear memory display on role change (different user context)
      renderMemory([]);
    });
    // Load memory on first page visit (best effort — needs token first)
    // We load lazily after first send so we always have a token
    // Enter to submit (Shift+Enter for newline)
    ['account', 'enablement'].forEach(agent => {
      document.getElementById('input-' + agent).addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(agent); }
      });
    });
  });

  function renderHints() {
    const role = document.getElementById('role-select').value;
    ['account', 'enablement'].forEach(agent => {
      const container = document.getElementById('hints-' + agent);
      container.innerHTML = '';
      let hints = [...HINTS[agent]];
      if (role === 'sales_manager' && MANAGER_HINTS[agent]) {
        hints = [...MANAGER_HINTS[agent], ...hints.slice(0, 1)];
      }
      hints.forEach(hint => {
        const chip = document.createElement('button');
        chip.className = 'hint-chip';
        chip.textContent = hint;
        chip.onclick = () => {
          document.getElementById('input-' + agent).value = hint;
          send(agent);
        };
        container.appendChild(chip);
      });
    });
  }

  // ── Token management ───────────────────────────────────────────────────────
  async function getToken() {
    if (token) return token;
    const role = document.getElementById('role-select').value;
    const name = document.getElementById('user-name-input').value.trim() || 'Demo User';
    const userId = name.toLowerCase().replace(/\\s+/g, '-') + '-' + role;

    const resp = await fetch('/dev/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, role, name, orgId: 'portfolio-org' }),
    });

    if (!resp.ok) throw new Error('Failed to get auth token');
    const data = await resp.json();
    token = data.token;
    setStatus(true);
    // Load memory once we have auth — non-blocking
    loadMemory();
    return token;
  }

  // ── Send (streaming) ──────────────────────────────────────────────────────
  // Uses the /stream SSE endpoint. Tokens appear as they arrive.
  // Falls back to the standard JSON endpoint if streaming fails.
  async function send(agent) {
    const inputEl = document.getElementById('input-' + agent);
    const message = inputEl.value.trim();
    if (!message) return;

    const emptyEl = document.getElementById('empty-' + agent);
    if (emptyEl) emptyEl.style.display = 'none';

    inputEl.value = '';
    const btn = document.getElementById('send-' + agent);
    btn.disabled = true;

    if (!threads[agent]) threads[agent] = crypto.randomUUID();

    appendMsg(agent, 'user', message);
    const thinkingId = appendThinking(agent);

    try {
      const tok = await getToken();

      // Open streaming connection
      const resp = await fetch('/api/v1/' + agent + '/stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + tok,
        },
        body: JSON.stringify({ message, threadId: threads[agent] }),
      });

      if (!resp.ok || !resp.body) {
        // Non-2xx or no body — fall back to JSON endpoint
        removeThinking(agent, thinkingId);
        const err = await resp.json().catch(() => ({ error: 'Request failed' }));
        appendMsg(agent, 'error', err.error || 'Request failed');
        return;
      }

      // Create the agent message bubble immediately (empty) and stream into it
      removeThinking(agent, thinkingId);
      const { bodyEl, footerEl } = appendStreamingMsg(agent);

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let toolsUsed = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE lines from the buffer
        const lines = buffer.split('\\n');
        buffer = lines.pop(); // keep the incomplete last line

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (!payload) continue;

          let event;
          try { event = JSON.parse(payload); } catch { continue; }

          if (event.type === 'tools') {
            // Show tool badges immediately — before any tokens arrive
            toolsUsed = event.toolsUsed || [];
            toolsUsed.forEach(t => {
              const badge = document.createElement('span');
              badge.className = 'tool-badge';
              badge.textContent = t.replace(/_/g, ' ');
              footerEl.appendChild(badge);
            });
          } else if (event.type === 'token') {
            // Append token text to the message body
            bodyEl.textContent += event.text;
            // Auto-scroll as tokens arrive
            const container = document.getElementById('msgs-' + agent);
            container.scrollTop = container.scrollHeight;
          } else if (event.type === 'done') {
            // Remove streaming cursor border, add latency badge
            bodyEl.style.borderColor = '';
            if (event.latencyMs) {
              const lat = document.createElement('span');
              lat.className = 'latency-badge';
              lat.textContent = (event.latencyMs / 1000).toFixed(1) + 's';
              footerEl.appendChild(lat);
            }
            // Refresh memory bar after response — slight delay lets KV write settle
            setTimeout(loadMemory, 3000);
          } else if (event.type === 'error') {
            bodyEl.textContent = event.message || 'An error occurred.';
            bodyEl.style.color = 'var(--red)';
          }
        }
      }

    } catch (err) {
      removeThinking(agent, thinkingId);
      appendMsg(agent, 'error', err.message || 'Network error');
      toast(err.message || 'Network error', true);
    } finally {
      btn.disabled = false;
      inputEl.focus();
    }
  }

  // ── DOM helpers ───────────────────────────────────────────────────────────

  // Create an empty agent message bubble for streaming into.
  // Returns refs to the body and footer elements so the caller can
  // append tokens and badges as they arrive.
  function appendStreamingMsg(agent) {
    const container = document.getElementById('msgs-' + agent);
    const div = document.createElement('div');
    div.className = 'msg agent';

    const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const metaEl = document.createElement('div');
    metaEl.className = 'msg-meta';
    metaEl.innerHTML = '<span class="msg-role agent">intel</span><span>' + now + '</span>';

    const bodyEl = document.createElement('div');
    bodyEl.className = 'msg-body';
    // Blinking cursor while streaming
    bodyEl.style.borderColor = 'var(--accent)';

    const footerEl = document.createElement('div');
    footerEl.className = 'msg-footer';

    div.appendChild(metaEl);
    div.appendChild(bodyEl);
    div.appendChild(footerEl);
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;

    return { div, bodyEl, footerEl };
  }

  function appendMsg(agent, role, text, meta = null) {
    const container = document.getElementById('msgs-' + agent);
    const div = document.createElement('div');
    div.className = 'msg ' + role;

    const roleLabels = { user: 'you', agent: 'intel', error: 'error', system: 'system' };
    const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    div.innerHTML =
      '<div class="msg-meta">' +
        '<span class="msg-role ' + role + '">' + (roleLabels[role] || role) + '</span>' +
        '<span>' + now + '</span>' +
      '</div>' +
      '<div class="msg-body">' + escHtml(text) + '</div>';

    if (meta && (meta.tools?.length || meta.latency)) {
      const footer = document.createElement('div');
      footer.className = 'msg-footer';
      (meta.tools || []).forEach(t => {
        const badge = document.createElement('span');
        badge.className = 'tool-badge';
        badge.textContent = t.replace(/_/g, ' ');
        footer.appendChild(badge);
      });
      if (meta.latency) {
        const lat = document.createElement('span');
        lat.className = 'latency-badge';
        lat.textContent = (meta.latency / 1000).toFixed(1) + 's';
        footer.appendChild(lat);
      }
      div.appendChild(footer);
    }

    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    return div;
  }

  function appendThinking(agent) {
    const container = document.getElementById('msgs-' + agent);
    const id = 'thinking-' + agent + '-' + Date.now();
    const div = document.createElement('div');
    div.id = id;
    div.className = 'msg thinking';
    div.innerHTML =
      '<div class="msg-meta"><span class="msg-role agent">intel</span></div>' +
      '<div class="msg-body">Thinking<span class="dots"></span></div>';
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    return id;
  }

  function removeThinking(agent, id) {
    const el = document.getElementById(id);
    if (el) el.remove();
  }

  function escHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function setStatus(connected) {
    const dot = document.getElementById('status-dot');
    dot.classList.toggle('connected', connected);
  }

  function toast(msg, isError = false) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = isError ? 'error' : '';
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 3000);
  }
</script>
</body>
</html>`;
}
