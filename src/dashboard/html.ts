export const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>cross-agent-memory dashboard</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #1a1a2e; color: #eee; padding: 20px; }
    h1 { font-size: 1.4em; margin-bottom: 16px; color: #e2e2e2; }
    h2 { font-size: 1.1em; margin: 20px 0 10px; color: #ccc; }
    a { color: #7db8f0; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 20px; }
    .card { background: #16213e; border-radius: 8px; padding: 16px; }
    .card .label { font-size: 0.8em; color: #999; text-transform: uppercase; letter-spacing: 0.05em; }
    .card .stat { font-size: 2em; font-weight: bold; color: #7db8f0; margin-top: 4px; }
    .controls { display: flex; gap: 12px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; }
    select, input { background: #16213e; color: #eee; border: 1px solid #333; border-radius: 4px; padding: 6px 10px; font-size: 0.9em; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
    th { text-align: left; padding: 8px 12px; border-bottom: 2px solid #333; color: #999; font-size: 0.85em; text-transform: uppercase; }
    td { padding: 8px 12px; border-bottom: 1px solid #262640; font-size: 0.9em; }
    tr:hover td { background: #1e2a4a; }
    .agent-badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.82em; font-weight: 600; }
    .agent-copilot { background: #238636; color: #fff; }
    .agent-claude { background: #c96442; color: #fff; }
    .agent-gemini { background: #4285f4; color: #fff; }
    .agent-chatgpt { background: #10a37f; color: #fff; }
    .detail-panel { background: #16213e; border-radius: 8px; padding: 20px; margin-top: 16px; display: none; }
    .detail-panel.visible { display: block; }
    .detail-panel h2 { margin-top: 0; }
    .detail-close { cursor: pointer; float: right; color: #999; font-size: 1.2em; }
    .detail-close:hover { color: #fff; }
    .tag-list { display: flex; flex-wrap: wrap; gap: 6px; margin: 6px 0; }
    .tag { background: #262640; padding: 2px 8px; border-radius: 4px; font-size: 0.82em; }
    pre { background: #0d1117; padding: 12px; border-radius: 6px; overflow-x: auto; font-size: 0.82em; margin-top: 8px; max-height: 300px; overflow-y: auto; }
    .section { margin-bottom: 16px; }
    .empty { color: #666; font-style: italic; }
    .tabs { display: flex; gap: 0; margin-bottom: 16px; }
    .tab { padding: 8px 16px; background: #16213e; border: 1px solid #333; cursor: pointer; font-size: 0.9em; color: #999; }
    .tab:first-child { border-radius: 6px 0 0 6px; }
    .tab:last-child { border-radius: 0 6px 6px 0; }
    .tab.active { background: #1e2a4a; color: #eee; border-color: #7db8f0; }
  </style>
</head>
<body>
  <h1>&#x1f9e0; cross-agent-memory</h1>

  <div class="grid" id="stats"></div>

  <div class="tabs">
    <div class="tab active" data-tab="sessions" onclick="switchTab('sessions')">Sessions</div>
    <div class="tab" data-tab="knowledge" onclick="switchTab('knowledge')">Knowledge</div>
  </div>

  <div id="sessions-tab">
    <div class="controls">
      <label>Project: <select id="project-filter"><option value="">All projects</option></select></label>
    </div>
    <table>
      <thead><tr><th>Agent</th><th>Project</th><th>Summary</th><th>Time</th></tr></thead>
      <tbody id="sessions-body"></tbody>
    </table>
  </div>

  <div id="knowledge-tab" style="display:none">
    <table>
      <thead><tr><th>Type</th><th>Title</th><th>Project</th><th>Agent</th><th>Created</th></tr></thead>
      <tbody id="knowledge-body"></tbody>
    </table>
  </div>

  <div class="detail-panel" id="detail">
    <span class="detail-close" onclick="closeDetail()">&times;</span>
    <div id="detail-content"></div>
  </div>

<script>
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.getElementById('sessions-tab').style.display = name === 'sessions' ? '' : 'none';
  document.getElementById('knowledge-tab').style.display = name === 'knowledge' ? '' : 'none';
}

function badge(agent) {
  const safe = esc(agent);
  return '<span class="agent-badge agent-' + safe + '">' + safe + '</span>';
}

function timeAgo(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = Date.now();
  const sec = Math.floor((now - d.getTime()) / 1000);
  if (sec < 60) return sec + 's ago';
  if (sec < 3600) return Math.floor(sec / 60) + 'm ago';
  if (sec < 86400) return Math.floor(sec / 3600) + 'h ago';
  return Math.floor(sec / 86400) + 'd ago';
}

function esc(s) {
  if (!s) return '';
  const el = document.createElement('span');
  el.textContent = s;
  return el.innerHTML;
}

async function loadStats() {
  const res = await fetch('/api/stats');
  const s = await res.json();
  document.getElementById('stats').innerHTML =
    '<div class="card"><div class="label">Sessions</div><div class="stat">' + s.totalSessions + '</div></div>' +
    '<div class="card"><div class="label">Knowledge</div><div class="stat">' + s.totalKnowledge + '</div></div>' +
    '<div class="card"><div class="label">Chunks</div><div class="stat">' + s.totalChunks + '</div></div>' +
    '<div class="card"><div class="label">Projects</div><div class="stat">' + Object.keys(s.byAgent).length + '</div></div>';
}

async function loadProjects() {
  const res = await fetch('/api/projects');
  const projects = await res.json();
  const sel = document.getElementById('project-filter');
  projects.forEach(function(p) {
    const o = document.createElement('option');
    o.value = p.projectId;
    o.textContent = p.projectId + ' (' + p.sessionCount + ')';
    sel.appendChild(o);
  });
}

async function loadSessions() {
  const project = document.getElementById('project-filter').value;
  const url = '/api/sessions' + (project ? '?project=' + encodeURIComponent(project) : '');
  const res = await fetch(url);
  const sessions = await res.json();
  const tbody = document.getElementById('sessions-body');
  if (!sessions.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty">No sessions found</td></tr>';
    return;
  }
  tbody.innerHTML = sessions.map(function(s) {
    return '<tr style="cursor:pointer" data-id="' + esc(s.id) + '" onclick="showSession(this.dataset.id)">' +
      '<td>' + badge(s.agent) + '</td>' +
      '<td>' + esc(s.projectId) + '</td>' +
      '<td>' + esc((s.summary || '').slice(0, 120)) + '</td>' +
      '<td>' + timeAgo(s.endedAt) + '</td></tr>';
  }).join('');
}

async function loadKnowledge() {
  const res = await fetch('/api/knowledge');
  const items = await res.json();
  const tbody = document.getElementById('knowledge-body');
  if (!items.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty">No knowledge entries</td></tr>';
    return;
  }
  tbody.innerHTML = items.map(function(k) {
    return '<tr><td><span class="tag">' + esc(k.type) + '</span></td>' +
      '<td>' + esc(k.title) + '</td>' +
      '<td>' + esc(k.projectId) + '</td>' +
      '<td>' + (k.sourceAgent ? badge(k.sourceAgent) : '') + '</td>' +
      '<td>' + timeAgo(k.createdAt) + '</td></tr>';
  }).join('');
}

async function showSession(id) {
  const res = await fetch('/api/sessions/' + encodeURIComponent(id));
  if (!res.ok) return;
  const s = await res.json();
  const panel = document.getElementById('detail');
  const c = document.getElementById('detail-content');

  let html = '<h2>' + badge(s.agent) + ' ' + esc(s.id) + '</h2>';
  html += '<div class="section"><strong>Project:</strong> ' + esc(s.projectId) + '</div>';
  html += '<div class="section"><strong>Summary:</strong> ' + esc(s.summary) + '</div>';

  if (s.filesModified && s.filesModified.length) {
    html += '<div class="section"><strong>Files modified:</strong><div class="tag-list">' +
      s.filesModified.map(function(f) { return '<span class="tag">' + esc(f) + '</span>'; }).join('') + '</div></div>';
  }
  if (s.keyDecisions && s.keyDecisions.length) {
    html += '<div class="section"><strong>Key decisions:</strong><ul>' +
      s.keyDecisions.map(function(d) { return '<li>' + esc(d) + '</li>'; }).join('') + '</ul></div>';
  }
  if (s.tasksCompleted && s.tasksCompleted.length) {
    html += '<div class="section"><strong>Completed:</strong><ul>' +
      s.tasksCompleted.map(function(t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul></div>';
  }
  if (s.tasksPending && s.tasksPending.length) {
    html += '<div class="section"><strong>Pending:</strong><ul>' +
      s.tasksPending.map(function(t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul></div>';
  }
  if (s.rawCheckpoint) {
    html += '<div class="section"><strong>Raw checkpoint:</strong><pre>' + esc(s.rawCheckpoint) + '</pre></div>';
  }

  c.innerHTML = html;
  panel.classList.add('visible');
}

function closeDetail() {
  document.getElementById('detail').classList.remove('visible');
}

document.getElementById('project-filter').addEventListener('change', loadSessions);

loadStats();
loadProjects();
loadSessions();
loadKnowledge();
</script>
</body>
</html>`;
