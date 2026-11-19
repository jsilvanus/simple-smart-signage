import {
  apiUrl,
  buildScreenPayload,
  extractErrorMessage,
  formatAddedAt,
  previewUrl,
  reorderedEntryIds,
  resolveBasePath,
} from './helpers.js';

const base = resolveBasePath(location.pathname);

const state = {
  screens: [],
  selectedId: null,
  editingId: null,
  busy: false,
};

const els = {
  loginView: document.getElementById('login-view'),
  loginForm: document.getElementById('login-form'),
  loginPassword: document.getElementById('login-password'),
  loginError: document.getElementById('login-error'),
  loginSubmit: document.getElementById('login-submit'),

  appView: document.getElementById('app-view'),
  appError: document.getElementById('app-error'),
  appStatus: document.getElementById('app-status'),
  refreshBtn: document.getElementById('refresh-btn'),
  newScreenBtn: document.getElementById('new-screen-btn'),
  logoutBtn: document.getElementById('logout-btn'),

  screensCount: document.getElementById('screens-count'),
  screensList: document.getElementById('screens-list'),
  screensEmpty: document.getElementById('screens-empty'),

  noSelection: document.getElementById('no-selection'),
  screenDetail: document.getElementById('screen-detail'),
  detailName: document.getElementById('detail-name'),
  detailId: document.getElementById('detail-id'),
  detailMeta: document.getElementById('detail-meta'),
  previewLink: document.getElementById('preview-link'),
  editScreenBtn: document.getElementById('edit-screen-btn'),
  deleteScreenBtn: document.getElementById('delete-screen-btn'),

  playlistVersion: document.getElementById('playlist-version'),
  playlistEmpty: document.getElementById('playlist-empty'),
  entriesList: document.getElementById('entries-list'),

  screenDialog: document.getElementById('screen-dialog'),
  screenDialogTitle: document.getElementById('screen-dialog-title'),
  screenDialogClose: document.getElementById('screen-dialog-close'),
  screenDialogCancel: document.getElementById('screen-dialog-cancel'),
  screenDialogSubmit: document.getElementById('screen-dialog-submit'),
  screenForm: document.getElementById('screen-form'),
  screenFormError: document.getElementById('screen-form-error'),
  screenIdField: document.getElementById('screen-id-field'),
  screenId: document.getElementById('screen-id'),
  screenName: document.getElementById('screen-name'),
  screenOrientation: document.getElementById('screen-orientation'),
  screenWidth: document.getElementById('screen-width'),
  screenHeight: document.getElementById('screen-height'),
  screenDefaultSeconds: document.getElementById('screen-default-seconds'),
  screenMaxVideo: document.getElementById('screen-max-video'),

  confirmDialog: document.getElementById('confirm-dialog'),
  confirmTitle: document.getElementById('confirm-title'),
  confirmMessage: document.getElementById('confirm-message'),
  confirmOkBtn: document.getElementById('confirm-ok-btn'),
};

function showBanner(el, message) {
  if (!message) {
    el.hidden = true;
    el.textContent = '';
    return;
  }
  el.textContent = message;
  el.hidden = false;
}

function setStatus(message) {
  showBanner(els.appStatus, message);
}

function setError(message) {
  showBanner(els.appError, message);
}

function showLogin(errorMessage = '') {
  els.appView.hidden = true;
  els.loginView.hidden = false;
  showBanner(els.loginError, errorMessage);
  els.loginPassword.value = '';
  els.loginPassword.focus();
}

function showApp() {
  els.loginView.hidden = true;
  els.appView.hidden = false;
  showBanner(els.loginError, '');
}

async function apiFetch(path, { method = 'GET', body, redirectOn401 = true } = {}) {
  const headers = {};
  if (method !== 'GET' && method !== 'HEAD') {
    headers['X-Sissi-Admin'] = '1';
  }
  const init = {
    method,
    credentials: 'same-origin',
    headers,
  };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(apiUrl(base, path), init);
  let data = null;
  if (res.status !== 204) {
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      data = await res.json().catch(() => null);
    }
  }
  if (!res.ok) {
    const message = extractErrorMessage(data, `Request failed (${res.status})`);
    const err = new Error(message);
    err.status = res.status;
    err.code = data?.error?.code;
    if (res.status === 401 && redirectOn401) {
      showLogin(message);
    }
    throw err;
  }
  return data;
}

function createKindIcon(kind) {
  const wrap = document.createElement('span');
  wrap.className = 'kind-icon';
  wrap.title = kind === 'video' ? 'Video' : 'Image';
  wrap.setAttribute('aria-label', kind === 'video' ? 'Video' : 'Image');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '18');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');

  if (kind === 'video') {
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', '2');
    rect.setAttribute('y', '4');
    rect.setAttribute('width', '15');
    rect.setAttribute('height', '16');
    rect.setAttribute('rx', '2');
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    poly.setAttribute('points', '17 9 22 6 22 18 17 15 17 9');
    svg.append(rect, poly);
  } else {
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', '3');
    rect.setAttribute('y', '3');
    rect.setAttribute('width', '18');
    rect.setAttribute('height', '18');
    rect.setAttribute('rx', '2');
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', '8.5');
    circle.setAttribute('cy', '8.5');
    circle.setAttribute('r', '1.5');
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    poly.setAttribute('points', '21 15 16 10 5 21');
    svg.append(rect, circle, poly);
  }
  wrap.append(svg);
  return wrap;
}

function getSelectedScreen() {
  return state.screens.find((s) => s.id === state.selectedId) ?? null;
}

function renderScreensList() {
  els.screensCount.textContent = String(state.screens.length);
  els.screensEmpty.hidden = state.screens.length > 0;
  els.screensList.replaceChildren();

  for (const screen of state.screens) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'screen-item-btn';
    btn.setAttribute('aria-current', screen.id === state.selectedId ? 'true' : 'false');
    btn.addEventListener('click', () => {
      state.selectedId = screen.id;
      setError('');
      setStatus('');
      render();
    });

    const title = document.createElement('span');
    title.className = 'screen-item-title';
    const nameSpan = document.createElement('span');
    nameSpan.textContent = screen.name;
    const countSpan = document.createElement('span');
    countSpan.className = 'muted';
    countSpan.textContent = `${screen.entries?.length ?? screen.entryCount ?? 0}`;
    title.append(nameSpan, countSpan);

    const sub = document.createElement('span');
    sub.className = 'screen-item-sub';
    const dims = screen.width && screen.height ? `${screen.width}×${screen.height}` : 'auto';
    sub.textContent = `${screen.id} · ${screen.orientation} · ${dims}`;

    btn.append(title, sub);
    li.append(btn);
    els.screensList.append(li);
  }
}

function renderDetail() {
  const screen = getSelectedScreen();
  if (!screen) {
    els.noSelection.hidden = false;
    els.screenDetail.hidden = true;
    return;
  }

  els.noSelection.hidden = true;
  els.screenDetail.hidden = false;

  els.detailName.textContent = screen.name;
  els.detailId.textContent = screen.id;
  const dims = screen.width && screen.height ? `${screen.width}×${screen.height}px` : 'auto size';
  const maxVid = screen.maxVideoSeconds ? `max video ${screen.maxVideoSeconds}s` : 'no video limit';
  els.detailMeta.textContent = `${screen.orientation} · ${dims} · default image ${screen.defaultImageSeconds}s · ${maxVid}`;
  els.previewLink.href = previewUrl(base, screen.id);
  els.playlistVersion.textContent = `v${screen.playlistVersion ?? 0}`;

  const entries = screen.entries ?? [];
  els.playlistEmpty.hidden = entries.length > 0;
  els.entriesList.replaceChildren();

  entries.forEach((entry, index) => {
    const li = document.createElement('li');
    li.className = 'entry-row';

    const reorder = document.createElement('div');
    reorder.className = 'reorder-col';
    const upBtn = document.createElement('button');
    upBtn.type = 'button';
    upBtn.className = 'btn btn-sm';
    upBtn.textContent = '↑';
    upBtn.title = 'Move up';
    upBtn.setAttribute('aria-label', `Move ${entry.title} up`);
    upBtn.disabled = index === 0 || state.busy;
    upBtn.addEventListener('click', () => handleReorder(screen.id, entries, index, -1));

    const downBtn = document.createElement('button');
    downBtn.type = 'button';
    downBtn.className = 'btn btn-sm';
    downBtn.textContent = '↓';
    downBtn.title = 'Move down';
    downBtn.setAttribute('aria-label', `Move ${entry.title} down`);
    downBtn.disabled = index === entries.length - 1 || state.busy;
    downBtn.addEventListener('click', () => handleReorder(screen.id, entries, index, 1));
    reorder.append(upBtn, downBtn);

    const icon = createKindIcon(entry.kind);

    const info = document.createElement('div');
    info.className = 'entry-info';
    const titleEl = document.createElement('div');
    titleEl.className = 'entry-title';
    titleEl.textContent = entry.title || entry.entryId;

    const metaEl = document.createElement('div');
    metaEl.className = 'entry-meta';

    const pushGroup = document.createElement('span');
    pushGroup.className = 'push-group';
    const pushBadge = document.createElement('code');
    pushBadge.className = 'code-pill';
    pushBadge.textContent = entry.pushId;
    const removePushBtn = document.createElement('button');
    removePushBtn.type = 'button';
    removePushBtn.className = 'btn btn-sm btn-danger';
    removePushBtn.textContent = 'Remove push';
    removePushBtn.disabled = state.busy;
    removePushBtn.addEventListener('click', () => handleRemovePush(screen.id, entry.pushId));
    pushGroup.append(pushBadge, removePushBtn);

    const addedEl = document.createElement('span');
    addedEl.textContent = formatAddedAt(entry.addedAt);
    metaEl.append(pushGroup, addedEl);
    info.append(titleEl, metaEl);

    const controls = document.createElement('div');
    controls.className = 'entry-controls';

    if (entry.kind === 'image') {
      const secForm = document.createElement('form');
      secForm.className = 'seconds-form';
      const secInput = document.createElement('input');
      secInput.type = 'number';
      secInput.min = '1';
      secInput.max = '3600';
      secInput.required = true;
      secInput.className = 'seconds-input';
      secInput.value = String(entry.seconds);
      secInput.setAttribute('aria-label', `Seconds for ${entry.title}`);
      const unit = document.createElement('span');
      unit.className = 'muted';
      unit.textContent = 's';
      const saveBtn = document.createElement('button');
      saveBtn.type = 'submit';
      saveBtn.className = 'btn btn-sm';
      saveBtn.textContent = 'Save';
      saveBtn.disabled = state.busy;
      secForm.append(secInput, unit, saveBtn);
      secForm.addEventListener('submit', (e) => {
        e.preventDefault();
        handleUpdateSeconds(screen.id, entry.entryId, secInput.value);
      });
      controls.append(secForm);
    } else {
      const dur = document.createElement('span');
      dur.className = 'badge';
      dur.textContent = `${entry.seconds}s (video)`;
      controls.append(dur);
    }

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn btn-sm btn-danger';
    delBtn.textContent = 'Delete';
    delBtn.disabled = state.busy;
    delBtn.addEventListener('click', () => handleDeleteEntry(screen.id, entry.entryId));
    controls.append(delBtn);

    li.append(reorder, icon, info, controls);
    els.entriesList.append(li);
  });
}

function render() {
  renderScreensList();
  renderDetail();
}

async function loadScreens() {
  const data = await apiFetch('/admin/screens');
  state.screens = data?.screens ?? [];
  if (state.selectedId && !state.screens.some((s) => s.id === state.selectedId)) {
    state.selectedId = null;
  }
  if (!state.selectedId && state.screens.length > 0) {
    state.selectedId = state.screens[0].id;
  }
  showApp();
  render();
}

function confirmAction({ title, message, okLabel = 'Delete' }) {
  return new Promise((resolve) => {
    els.confirmTitle.textContent = title;
    els.confirmMessage.textContent = message;
    els.confirmOkBtn.textContent = okLabel;
    els.confirmDialog.returnValue = '';

    const onClose = () => {
      const choice = els.confirmDialog.returnValue;
      els.confirmDialog.returnValue = '';
      resolve(choice === 'confirm');
    };
    els.confirmDialog.addEventListener('close', onClose, { once: true });
    els.confirmDialog.showModal();
  });
}

function openScreenDialog(screen = null) {
  state.editingId = screen ? screen.id : null;
  showBanner(els.screenFormError, '');
  els.screenDialogTitle.textContent = screen ? `Edit screen: ${screen.id}` : 'New screen';

  if (screen) {
    els.screenIdField.hidden = true;
    els.screenId.disabled = true;
    els.screenId.required = false;
    els.screenId.value = screen.id;
    els.screenName.value = screen.name;
    els.screenOrientation.value = screen.orientation || 'landscape';
    els.screenWidth.value = screen.width ?? '';
    els.screenHeight.value = screen.height ?? '';
    els.screenDefaultSeconds.value = screen.defaultImageSeconds ?? 10;
    els.screenMaxVideo.value = screen.maxVideoSeconds ?? '';
  } else {
    els.screenIdField.hidden = false;
    els.screenId.disabled = false;
    els.screenId.required = true;
    els.screenForm.reset();
    els.screenOrientation.value = 'landscape';
    els.screenDefaultSeconds.value = '10';
  }

  els.screenDialog.showModal();
  (screen ? els.screenName : els.screenId).focus();
}

async function handleReorder(screenId, entries, index, delta) {
  const entryIds = reorderedEntryIds(entries, index, delta);
  if (!entryIds) return;
  setError('');
  setStatus('');
  state.busy = true;
  render();
  try {
    await apiFetch(`/admin/screens/${encodeURIComponent(screenId)}/entries`, {
      method: 'PUT',
      body: { entryIds },
    });
    await loadScreens();
    setStatus('Playlist order updated.');
  } catch (err) {
    setError(err.message);
  } finally {
    state.busy = false;
    render();
  }
}

async function handleUpdateSeconds(screenId, entryId, rawSeconds) {
  setError('');
  setStatus('');
  const seconds = Number(rawSeconds);
  state.busy = true;
  render();
  try {
    await apiFetch(`/admin/screens/${encodeURIComponent(screenId)}/entries/${encodeURIComponent(entryId)}`, {
      method: 'PATCH',
      body: { seconds },
    });
    await loadScreens();
    setStatus('Slide duration updated.');
  } catch (err) {
    setError(err.message);
  } finally {
    state.busy = false;
    render();
  }
}

async function handleDeleteEntry(screenId, entryId) {
  setError('');
  setStatus('');
  state.busy = true;
  render();
  try {
    await apiFetch(`/admin/screens/${encodeURIComponent(screenId)}/entries/${encodeURIComponent(entryId)}`, {
      method: 'DELETE',
    });
    await loadScreens();
    setStatus('Entry removed.');
  } catch (err) {
    setError(err.message);
  } finally {
    state.busy = false;
    render();
  }
}

async function handleRemovePush(screenId, pushId) {
  const confirmed = await confirmAction({
    title: 'Remove push?',
    message: `Remove all entries from push "${pushId}" on screen "${screenId}"?`,
    okLabel: 'Remove push',
  });
  if (!confirmed) return;

  setError('');
  setStatus('');
  state.busy = true;
  render();
  try {
    await apiFetch(`/admin/screens/${encodeURIComponent(screenId)}/pushes/${encodeURIComponent(pushId)}`, {
      method: 'DELETE',
    });
    await loadScreens();
    setStatus(`Removed push ${pushId}.`);
  } catch (err) {
    setError(err.message);
  } finally {
    state.busy = false;
    render();
  }
}

els.loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  showBanner(els.loginError, '');
  els.loginSubmit.disabled = true;
  try {
    await apiFetch('/admin/login', {
      method: 'POST',
      body: { password: els.loginPassword.value },
      redirectOn401: false,
    });
    await loadScreens();
  } catch (err) {
    showBanner(els.loginError, err.message);
  } finally {
    els.loginSubmit.disabled = false;
  }
});

els.logoutBtn.addEventListener('click', async () => {
  setError('');
  setStatus('');
  try {
    await apiFetch('/admin/logout', { method: 'POST', redirectOn401: false });
  } catch {
    // Clear UI state regardless
  }
  state.screens = [];
  state.selectedId = null;
  showLogin();
});

els.refreshBtn.addEventListener('click', async () => {
  setError('');
  setStatus('');
  try {
    await loadScreens();
    setStatus('Refreshed.');
  } catch (err) {
    setError(err.message);
  }
});

els.newScreenBtn.addEventListener('click', () => openScreenDialog(null));
els.editScreenBtn.addEventListener('click', () => {
  const screen = getSelectedScreen();
  if (screen) openScreenDialog(screen);
});

els.deleteScreenBtn.addEventListener('click', async () => {
  const screen = getSelectedScreen();
  if (!screen) return;
  const confirmed = await confirmAction({
    title: 'Delete screen?',
    message: `Delete screen "${screen.name}" (${screen.id}) and its playlist?`,
    okLabel: 'Delete screen',
  });
  if (!confirmed) return;

  setError('');
  setStatus('');
  try {
    await apiFetch(`/admin/screens/${encodeURIComponent(screen.id)}`, { method: 'DELETE' });
    await loadScreens();
    setStatus(`Deleted screen ${screen.id}.`);
  } catch (err) {
    setError(err.message);
  }
});

els.screenDialogClose.addEventListener('click', () => els.screenDialog.close());
els.screenDialogCancel.addEventListener('click', () => els.screenDialog.close());

els.screenForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  showBanner(els.screenFormError, '');
  const isCreate = !state.editingId;
  const payload = buildScreenPayload(
    {
      id: els.screenId.value,
      name: els.screenName.value,
      orientation: els.screenOrientation.value,
      width: els.screenWidth.value,
      height: els.screenHeight.value,
      defaultImageSeconds: els.screenDefaultSeconds.value,
      maxVideoSeconds: els.screenMaxVideo.value,
    },
    { isCreate },
  );

  els.screenDialogSubmit.disabled = true;
  try {
    if (isCreate) {
      const created = await apiFetch('/admin/screens', { method: 'POST', body: payload });
      state.selectedId = created?.id ?? payload.id;
      els.screenDialog.close();
      await loadScreens();
      setStatus(`Created screen ${state.selectedId}.`);
    } else {
      await apiFetch(`/admin/screens/${encodeURIComponent(state.editingId)}`, {
        method: 'PATCH',
        body: payload,
      });
      els.screenDialog.close();
      await loadScreens();
      setStatus(`Updated screen ${state.editingId}.`);
    }
  } catch (err) {
    showBanner(els.screenFormError, err.message);
  } finally {
    els.screenDialogSubmit.disabled = false;
  }
});

// Initial bootstrap
loadScreens().catch((err) => {
  if (err.status !== 401) {
    showLogin(err.message);
  }
});
