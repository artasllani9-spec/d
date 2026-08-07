(function () {
  const ADMIN_ROBLOX_ID = '3519737769';
  const panel = document.querySelector('.admin-tools-panel');
  const loading = document.querySelector('.admin-tools-loading');
  const form = document.getElementById('add-moderator-form');
  const input = document.getElementById('moderator-user-id');
  const statusEl = document.getElementById('moderator-status');
  const listEl = document.getElementById('moderator-list');

  function setStatus(message, isError) {
    if (!statusEl) return;
    statusEl.hidden = !message;
    statusEl.textContent = message || '';
    statusEl.classList.toggle('admin-moderator-status--error', Boolean(isError));
  }

  function renderModerators(moderators) {
    if (!listEl) return;
    const ids = Array.isArray(moderators) ? moderators : [];
    if (!ids.length) {
      listEl.innerHTML = '<li class="admin-moderator-list__empty">No site moderators yet.</li>';
      return;
    }

    listEl.innerHTML = ids.map((id) => `
      <li class="admin-moderator-list__item" data-user-id="${String(id)}">
        <span class="admin-moderator-list__id">${String(id)}</span>
        <button type="button" class="admin-moderator-list__remove">Remove</button>
      </li>
    `).join('');
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
          setStatus(`Added site moderator ${added}.`, false);
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
