const $ = (id) => document.getElementById(id);

let ws = null;
let lastSecret = '';
let eventCount = 0;
let availableEvents = [];

// OAuth scopes offered on the login screen, rendered as toggles.
const OAUTH_SCOPES = [
  { name: 'user:read', desc: 'Read your profile', default: true },
  { name: 'channel:read', desc: 'Read channel info', default: true },
  { name: 'events:subscribe', desc: 'Receive webhook events (required)', default: true },
  { name: 'channel:write', desc: 'Update channel info', default: false },
  { name: 'chat:write', desc: 'Send chat messages', default: false },
  { name: 'moderation:ban', desc: 'Ban / timeout users', default: false },
];

async function api(path, opts) {
  const r = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  if (r.status === 401) return null;
  return r.status === 204 ? {} : r.json();
}

function setStatus(on, text) {
  $('wsDot').classList.toggle('on', on);
  $('statusText').textContent = text;
}

// OAuth scopes are rendered as one boolean toggle each on the login screen.
function renderScopeGrid() {
  const grid = $('scopeGrid');
  grid.innerHTML = '';
  for (const scope of OAUTH_SCOPES) {
    const el = document.createElement('label');
    el.className = 'toggle';
    el.title = scope.desc;
    el.innerHTML = `<span>${scope.name}</span>
      <span class="switch"><input type="checkbox" class="scope" value="${scope.name}"
      ${scope.default ? 'checked' : ''} />
      <span class="track"><span class="thumb"></span></span></span>`;
    grid.appendChild(el);
  }
}

function collectScopes() {
  const picked = [...document.querySelectorAll('.scope:checked')].map((c) => c.value);
  return picked.length ? picked.join(' ') : 'user:read';
}

// Token permissions are rendered as one boolean toggle per available event.
function renderPermGrid() {
  const grid = $('permGrid');
  grid.innerHTML = '';
  if (!availableEvents.length) {
    grid.innerHTML = '<span class="muted">No events configured on the server.</span>';
  }
  for (const ev of availableEvents) {
    const el = document.createElement('label');
    el.className = 'toggle';
    el.innerHTML = `<span>${ev}</span>
      <span class="switch"><input type="checkbox" class="permEvent" value="${ev}" />
      <span class="track"><span class="thumb"></span></span></span>`;
    grid.appendChild(el);
  }
  updatePermState();
}

function updatePermState() {
  const all = $('permAll').checked;
  for (const c of document.querySelectorAll('.permEvent')) {
    c.disabled = all;
    c.closest('.toggle').style.opacity = all ? 0.45 : 1;
  }
}

function collectPermissions() {
  if ($('permAll').checked) return '*';
  const picked = [...document.querySelectorAll('.permEvent:checked')].map((c) => c.value);
  return picked.length ? picked.join(' ') : '*';
}

function renderTokens(tokens) {
  const box = $('tokenList');
  box.innerHTML = tokens.length ? '' : '<p class="muted" style="margin:0 0 6px">No tokens yet.</p>';
  for (const t of tokens) {
    const div = document.createElement('div');
    div.className = 'token-row';
    const used = t.last_used_at ? `used ${new Date(t.last_used_at).toLocaleString()}` : 'never used';
    const perms = t.permissions === '*' ? 'all events' : t.permissions;
    div.innerHTML = `
      <div class="meta">
        <div class="name">${t.label || '(unlabeled)'}
          ${t.revoked ? '<span class="pill revoked">revoked</span>' : '<span class="pill ok">active</span>'}</div>
        <div class="info mono">${perms} · id ${t.id} · ${used}</div>
      </div>
      ${t.revoked ? '' : `<button class="danger" data-id="${t.id}">Revoke</button>`}`;
    const btn = div.querySelector('button');
    if (btn) {
      btn.onclick = async () => {
        if (!confirm('Revoke this token? Apps using it will disconnect.')) return;
        await api(`/api/tokens/${t.id}`, { method: 'DELETE' });
        refresh();
      };
    }
    box.appendChild(div);
  }
}

async function refresh() {
  const me = await api('/api/me');
  if (!me) {
    $('loggedOut').classList.remove('hidden');
    $('loggedIn').classList.add('hidden');
    return;
  }
  $('loggedOut').classList.add('hidden');
  $('loggedIn').classList.remove('hidden');
  $('uName').textContent = me.user.username || me.user.id;
  $('uChannel').textContent = me.user.channel_id;
  $('uScopes').textContent = me.user.scopes.join(' ') || '—';
  $('uSubs').textContent = me.subscriptions.map((s) => s.event_name).join(', ') || '—';
  availableEvents = me.available_events || [];
  renderPermGrid();
  renderTokens(me.tokens);
}

// Live debug feed over the authenticated WebSocket.
function addSystemLine(text) {
  const feed = $('feed');
  const empty = feed.querySelector('.empty');
  if (empty) empty.remove();
  const node = document.createElement('div');
  node.className = 'sys';
  node.textContent = text;
  feed.prepend(node);
}

function addEvent(d) {
  eventCount++;
  $('feedCount').textContent = `${eventCount} ${eventCount === 1 ? 'event' : 'events'}`;
  const feed = $('feed');
  const empty = feed.querySelector('.empty');
  if (empty) empty.remove();
  const time = new Date().toLocaleTimeString();
  const ev = document.createElement('details');
  ev.className = 'event';
  ev.innerHTML = `<summary><span class="type">${d.type}</span>
    <span class="time">v${d.version} · ${time}</span></summary>
    <pre>${JSON.stringify(d.data, null, 2).replace(/</g, '&lt;')}</pre>`;
  feed.prepend(ev);
}

// The feed authenticates with the browser session cookie (sent automatically
// on the same-origin handshake), so no token is required here.
function connectFeed() {
  if (ws) ws.close();
  const url = `${location.origin.replace(/^http/, 'ws')}/ws`;
  ws = new WebSocket(url);
  ws.onopen = () => setStatus(true, 'live');
  ws.onclose = () => {
    setStatus(false, 'offline');
    addSystemLine('disconnected');
  };
  ws.onerror = () => addSystemLine('connection error');
  ws.onmessage = (m) => {
    let d;
    try {
      d = JSON.parse(m.data);
    } catch {
      return;
    }
    if (d.kind === 'welcome') {
      $('feedInfo').textContent = `channel ${d.channel_id} · ${d.auth} auth · perms ${d.permissions}`;
      addSystemLine('connected — listening for events');
    } else if (d.kind === 'event') {
      addEvent(d);
    }
  };
}

function clearFeed() {
  eventCount = 0;
  $('feedCount').textContent = '0 events';
  $('feed').innerHTML = '<div class="empty">Cleared.</div>';
}

async function createTokenFromForm() {
  const body = JSON.stringify({ label: $('tLabel').value, permissions: collectPermissions() });
  const t = await api('/api/tokens', { method: 'POST', body });
  lastSecret = t.plaintext;
  $('secretBox').classList.remove('hidden');
  $('secretVal').textContent = t.plaintext;
  $('tLabel').value = '';
  refresh();
}

async function logout() {
  if (!confirm('Destroy the session and revoke all Kick webhooks?')) return;
  if (ws) ws.close();
  await api('/api/logout', { method: 'POST' });
  refresh();
}

function disconnectFeed() {
  if (ws) {
    ws.close();
    ws = null;
  }
}

// Switch dashboard tabs; auto-connect the feed the first time it opens.
function selectTab(name) {
  for (const btn of document.querySelectorAll('.tab-btn')) {
    btn.classList.toggle('active', btn.dataset.tab === name);
  }
  for (const panel of document.querySelectorAll('.tab-panel')) {
    panel.classList.toggle('hidden', panel.dataset.panel !== name);
  }
  if (name === 'feed' && !ws) connectFeed();
}

function wireEvents() {
  $('permAll').onchange = updatePermState;
  $('loginBtn').onclick = () => {
    location.href = `/oauth/login?scopes=${encodeURIComponent(collectScopes())}`;
  };
  $('logoutBtn').onclick = logout;
  $('createTokenBtn').onclick = createTokenFromForm;
  $('copySecret').onclick = () => navigator.clipboard?.writeText(lastSecret);
  $('feedConnect').onclick = connectFeed;
  $('feedDisconnect').onclick = disconnectFeed;
  $('feedClear').onclick = clearFeed;
  for (const btn of document.querySelectorAll('.tab-btn')) {
    btn.onclick = () => selectTab(btn.dataset.tab);
  }
}

wireEvents();
renderScopeGrid();
refresh();
