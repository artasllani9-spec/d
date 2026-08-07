(function () {
  const panel = document.querySelector('.reports-panel');
  const loading = document.querySelector('.reports-loading');
  const listEl = document.getElementById('reports-list');
  const emptyEl = document.getElementById('reports-empty');

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatTime(timestamp) {
    if (!timestamp) return '';
    try {
      return new Date(timestamp).toLocaleString();
    } catch {
      return '';
    }
  }

  function formatUser(id, username) {
    const handle = username ? `@${username}` : 'Unknown';
    return `${handle} (${id || '—'})`;
  }

  function renderReports(reports) {
    if (!listEl || !emptyEl) return;
    const list = Array.isArray(reports) ? reports : [];
    if (!list.length) {
      listEl.innerHTML = '';
      emptyEl.hidden = false;
      return;
    }

    emptyEl.hidden = true;
    listEl.innerHTML = list.map((report) => `
      <li class="reports-list__item">
        <div class="reports-list__meta">
          <p class="reports-list__reported">
            Reported: <a href="profile.html?id=${encodeURIComponent(report.reportedId)}">${escapeHtml(formatUser(report.reportedId, report.reportedUsername))}</a>
          </p>
          <p class="reports-list__reporter">
            By: <a href="profile.html?id=${encodeURIComponent(report.reporterId)}">${escapeHtml(formatUser(report.reporterId, report.reporterUsername))}</a>
          </p>
          <time class="reports-list__time">${escapeHtml(formatTime(report.createdAt))}</time>
        </div>
        <p class="reports-list__reason">${escapeHtml(report.reason)}</p>
      </li>
    `).join('');
  }

  fetch('/api/auth/me', { credentials: 'same-origin' })
    .then((response) => (response.ok ? response.json() : null))
    .then(async (data) => {
      if (data && data.banned) {
        window.location.replace('banned.html');
        return;
      }

      const user = data && data.user ? data.user : null;
      const isModerator = Boolean(data && data.roles && data.roles.isModerator);
      if (!user || !isModerator) {
        window.location.replace('index.html');
        return;
      }

      const response = await fetch('/api/moderation/reports', { credentials: 'same-origin' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.message || 'Could not load reports.');
      }

      if (loading) loading.hidden = true;
      if (panel) panel.hidden = false;
      renderReports(payload.reports);
    })
    .catch(() => {
      window.location.replace('index.html');
    });
})();
