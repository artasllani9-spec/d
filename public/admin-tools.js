(function () {
  const ADMIN_ROBLOX_ID = '3519737769';
  const panel = document.querySelector('.admin-tools-panel');
  const loading = document.querySelector('.admin-tools-loading');
  const form = document.getElementById('add-moderator-form');
  const input = document.getElementById('moderator-user-id');
  const statusEl = document.getElementById('moderator-status');
  const listEl = document.getElementById('moderator-list');
  const unbanForm = document.getElementById('unban-form');
  const unbanInput = document.getElementById('unban-user-id');
  const unbanStatusEl = document.getElementById('unban-status');

  function setStatus(message, isError) {
    if (!statusEl) return;
    statusEl.hidden = !message;
    statusEl.textContent = message || '';
    statusEl.classList.toggle('admin-moderator-status--error', Boolean(isError));
  }

  function setUnbanStatus(message, isError) {
    if (!unbanStatusEl) return;
    unbanStatusEl.hidden = !message;
    unbanStatusEl.textContent = message || '';
    unbanStatusEl.classList.toggle('admin-moderator-status--error', Boolean(isError));
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatModeratorLabel(moderator) {
    const id = typeof moderator === 'object' && moderator
      ? String(moderator.id || '')
      : String(moderator || '');
    const username = typeof moderator === 'object' && moderator && moderator.username
      ? String(moderator.username)
      : '';
    if (!id) return 'Unknown';
    return username ? `${id} @${username}` : id;
  }

  function renderModerators(moderators) {
    if (!listEl) return;
    const list = Array.isArray(moderators) ? moderators : [];
    if (!list.length) {
      listEl.innerHTML = '<li class="admin-moderator-list__empty">No site moderators yet.</li>';
      return;
    }

    listEl.innerHTML = list.map((moderator) => {
      const id = typeof moderator === 'object' && moderator
        ? String(moderator.id || '')
        : String(moderator || '');
      const label = formatModeratorLabel(moderator);
      return `
      <li class="admin-moderator-list__item" data-user-id="${escapeHtml(id)}">
        <span class="admin-moderator-list__id">${escapeHtml(label)}</span>
        <button type="button" class="admin-moderator-list__remove">Remove</button>
      </li>
    `;
    }).join('');
  }

  async function loadModerators() {
    const response = await fetch('/api/moderation/moderators', { credentials: 'same-origin' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.message || 'Could not load moderators.');
    }
    renderModerators(data.moderators);
  }

  async function addModerator(userId) {
    const response = await fetch('/api/moderation/moderators', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.message || 'Could not add moderator.');
    }
    renderModerators(data.moderators);
    return data.added;
  }

  async function removeModerator(userId) {
    const response = await fetch(`/api/moderation/moderators/${encodeURIComponent(userId)}`, {
      method: 'DELETE',
      credentials: 'same-origin',
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.message || 'Could not remove moderator.');
    }
    renderModerators(data.moderators);
  }

  async function unbanUser(userId) {
    const response = await fetch(`/api/moderation/bans/${encodeURIComponent(userId)}`, {
      method: 'DELETE',
      credentials: 'same-origin',
    });
    if (response.status === 204) return true;
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message || 'Could not unban user.');
  }

  if (form && input) {
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const userId = String(input.value || '').trim();
      if (!/^\d+$/.test(userId)) {
        setStatus('Enter a valid Roblox user ID.', true);
        return;
      }

      setStatus('Adding moderator…', false);
      addModerator(userId)
        .then((added) => {
          input.value = '';
          setStatus(`Added site moderator ${formatModeratorLabel(added)}.`, false);
        })
        .catch((error) => {
          setStatus((error && error.message) || 'Could not add moderator.', true);
        });
    });
  }

  if (listEl) {
    listEl.addEventListener('click', (event) => {
      const button = event.target.closest('.admin-moderator-list__remove');
      if (!button) return;
      const item = button.closest('[data-user-id]');
      const userId = item && item.dataset.userId;
      if (!userId) return;
      if (!window.confirm(`Remove site moderator ${userId}?`)) return;

      setStatus('Removing moderator…', false);
      removeModerator(userId)
        .then(() => setStatus(`Removed site moderator ${userId}.`, false))
        .catch((error) => {
          setStatus((error && error.message) || 'Could not remove moderator.', true);
        });
    });
  }

  if (unbanForm && unbanInput) {
    unbanForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const userId = String(unbanInput.value || '').trim();
      if (!/^\d+$/.test(userId)) {
        setUnbanStatus('Enter a valid Roblox user ID.', true);
        return;
      }

      setUnbanStatus('Unbanning user…', false);
      unbanUser(userId)
        .then(() => {
          unbanInput.value = '';
          setUnbanStatus(`Unbanned user ${userId}.`, false);
        })
        .catch((error) => {
          setUnbanStatus((error && error.message) || 'Could not unban user.', true);
        });
    });
  }

  fetch('/api/auth/me', { credentials: 'same-origin' })
    .then((response) => (response.ok ? response.json() : null))
    .then(async (data) => {
      if (data && data.banned) {
        window.location.replace('banned.html');
        return;
      }

      const user = data && data.user ? data.user : null;
      if (!user || String(user.id) !== ADMIN_ROBLOX_ID) {
        window.location.replace('index.html');
        return;
      }

      if (loading) loading.hidden = true;
      if (panel) panel.hidden = false;
      await loadModerators();
    })
    .catch(() => {
      window.location.replace('index.html');
    });
})();
