import {
  apiUrl,
  buildScreenPayload,
  extractErrorMessage,
  formatAddedAt,
  formatScheduleWindows,
  previewUrl,
  reorderedEntryIds,
  resolveBasePath,
} from './helpers.js';

const base = resolveBasePath(location.pathname);

const state = {
  // Server clock minus local clock (ms), from the last screens fetch; used for the now-playing marker.
  clockOffsetMs: 0,
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
  powerBadge: document.getElementById('power-badge'),
  powerOverrideGroup: document.getElementById('power-override-group'),
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
  screenPowerDriver: document.getElementById('screen-power-driver'),
  screenPowerLanId: document.getElementById('screen-power-lan-id'),
  screenPowerRouterId: document.getElementById('screen-power-router-id'),
  screenPowerTimezone: document.getElementById('screen-power-timezone'),
  screenPowerMac: document.getElementById('screen-power-mac'),
  screenPowerIp: document.getElementById('screen-power-ip'),
  screenPowerWindows: document.getElementById('screen-power-windows'),

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

  const hasPower = Boolean(screen.power && screen.power.driver && screen.power.driver !== 'none');
  els.powerOverrideGroup.hidden = !hasPower;
  if (hasPower) {
    const activeOverride = screen.power.override || 'auto';
    for (const btn of els.powerOverrideGroup.querySelectorAll('[data-power-override]')) {
      const val = btn.dataset.powerOverride;
      btn.classList.toggle('btn-primary', val === activeOverride);
      btn.setAttribute('aria-pressed', val === activeOverride ? 'true' : 'false');
      btn.disabled = state.busy;
    }
    const ps = screen.powerStatus;
    els.powerBadge.hidden = false;
    els.powerBadge.classList.remove('power-badge-online', 'power-badge-offline');
    if (!ps) {
      els.powerBadge.textContent = 'power: unknown';
    } else if (ps.error) {
      els.powerBadge.textContent = `power: error (${ps.error})`;
      els.powerBadge.classList.add('power-badge-offline');
    } else if (ps.reachable) {
      els.powerBadge.textContent = 'TV online';
      els.powerBadge.classList.add('power-badge-online');
    } else {
      els.powerBadge.textContent = 'TV standby';
      els.powerBadge.classList.add('power-badge-offline');
    }
  } else {
    els.powerBadge.hidden = true;
  }

  renderEntries(screen);
}

let dragFromIndex = null;

function clearDropMarks() {
  for (const li of els.entriesList.children) li.classList.remove('drop-target');
}

function mediaUrlFor(entry) {
  return `${base}/media/${entry.mediaId}.${entry.ext || 'png'}`;
}

function thumbFor(entry) {
  const img = document.createElement('img');
  img.className = 'entry-thumb';
  img.alt = '';
  img.loading = 'lazy';
  img.decoding = 'async';
  img.src = mediaUrlFor(entry);
  return img;
}

async function handleMove(screenId, entries, from, to) {
  if (from === to || from == null || to == null) return;
  const ids = entries.map((e) => e.entryId);
  const [moved] = ids.splice(from, 1);
  ids.splice(to, 0, moved);
  setError('');
  state.busy = true;
  try {
    await apiFetch(`/admin/screens/${encodeURIComponent(screenId)}/entries`, {
      method: 'PUT',
      body: { entryIds: ids },
    });
    setStatus('Playlist order updated.');
  } catch (err) {
    setError(err.message);
  } finally {
    state.busy = false;
    await loadScreens();
  }
}

function renderEntries(screen) {
  const entries = screen.entries ?? [];
  els.playlistEmpty.hidden = entries.length > 0;
  els.entriesList.replaceChildren();

  entries.forEach((entry, index) => {
    const li = document.createElement('li');
    li.className = entry.enabled === false ? 'entry-row entry-disabled' : 'entry-row';

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
    const grip = document.createElement('span');
    grip.className = 'drag-grip';
    grip.textContent = '⠿';
    grip.title = 'Drag to reorder';
    grip.setAttribute('aria-hidden', 'true');
    reorder.append(grip);
    // Only the grip starts a drag, so inputs and buttons keep working.
    grip.addEventListener('pointerdown', () => { li.draggable = true; });
    li.addEventListener('dragend', () => { li.draggable = false; li.classList.remove('dragging'); clearDropMarks(); dragFromIndex = null; });
    li.addEventListener('dragstart', (ev) => {
      dragFromIndex = index;
      li.classList.add('dragging');
      ev.dataTransfer.effectAllowed = 'move';
      ev.dataTransfer.setData('text/plain', entry.entryId);
    });
    li.addEventListener('dragover', (ev) => {
      if (dragFromIndex === null) return;
      ev.preventDefault();
      clearDropMarks();
      li.classList.add('drop-target');
    });
    li.addEventListener('drop', (ev) => {
      if (dragFromIndex === null) return;
      ev.preventDefault();
      const from = dragFromIndex;
      dragFromIndex = null;
      clearDropMarks();
      handleMove(screen.id, entries, from, index);
    });

    const icon = entry.kind === 'image'
      ? thumbFor(entry)
      : createKindIcon(entry.kind);

    const info = document.createElement('div');
    info.className = 'entry-info';
    const nowBadge = document.createElement('span');
    nowBadge.className = 'now-badge';
    nowBadge.textContent = '▶ Now playing';
    nowBadge.hidden = true;
    info.append(nowBadge);
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
    const pushEnabledBtn = document.createElement('button');
    pushEnabledBtn.type = 'button';
    pushEnabledBtn.className = 'btn btn-sm';
    const pushAllOn = entries.filter((e) => e.pushId === entry.pushId).every((e) => e.enabled !== false);
    pushEnabledBtn.textContent = pushAllOn ? 'Disable push' : 'Enable push';
    pushEnabledBtn.disabled = state.busy;
    pushEnabledBtn.addEventListener('click', () => handleSetPushEnabled(screen.id, entry.pushId, !pushAllOn));
    pushGroup.append(pushBadge, pushEnabledBtn, removePushBtn);

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

    const isOn = entry.enabled !== false;
    const liveBadge = document.createElement('span');
    liveBadge.className = 'badge';
    liveBadge.textContent = isOn ? 'Live' : 'Disabled';
    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'btn btn-sm';
    toggleBtn.textContent = isOn ? 'Disable' : 'Enable';
    toggleBtn.setAttribute('aria-label', `${isOn ? 'Disable' : 'Enable'} ${entry.title}`);
    toggleBtn.disabled = state.busy;
    toggleBtn.addEventListener('click', () => handleSetEntryEnabled(screen.id, entry.entryId, !isOn));
    controls.append(liveBadge, toggleBtn);

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn btn-sm btn-danger';
    delBtn.textContent = 'Delete';
    delBtn.disabled = state.busy;
    delBtn.addEventListener('click', () => handleDeleteEntry(screen.id, entry.entryId));
    controls.append(delBtn);

    li.append(reorder, icon, info, controls);
    li.dataset.entryId = entry.entryId;
    li.dataset.index = String(index);
    els.entriesList.append(li);
  });
  updateNowPlaying();
}


/** Marks the entry every screen is playing at this moment. Same arithmetic as the player (src/playback/schedule.mjs). */
function updateNowPlaying() {
  const screen = getSelectedScreen();
  const entries = (screen?.entries ?? []).filter((e) => e.enabled !== false);
  let total = 0;
  for (const e of entries) total += Math.max(0, Number(e.seconds) || 0) * 1000;
  let playingId = null;
  if (total > 0) {
    const pos = (((Date.now() + state.clockOffsetMs) % total) + total) % total;
    let start = 0;
    for (const e of entries) {
      const len = Math.max(0, Number(e.seconds) || 0) * 1000;
      if (len <= 0) continue;
      if (pos < start + len) {
        playingId = e.entryId;
        break;
      }
      start += len;
    }
  }
  for (const li of els.entriesList.children) {
    const isNow = li.dataset.entryId === playingId;
    li.classList.toggle('entry-now', isNow);
    const badge = li.querySelector('.now-badge');
    if (badge) badge.hidden = !isNow;
  }
}

setInterval(updateNowPlaying, 1000);

// Thumbnail/list view. The choice is per browser and is optional, so storage errors are ignored.
const viewToggle = document.getElementById('view-toggle');
function applyView(grid) {
  els.entriesList.classList.toggle('entries-list--grid', grid);
  if (viewToggle) viewToggle.textContent = grid ? 'List view' : 'Thumbnail view';
}
applyView((() => { try { return window.localStorage.getItem('sissi:admin:view') === 'grid'; } catch { return false; } })());
viewToggle?.addEventListener('click', () => {
  const grid = !els.entriesList.classList.contains('entries-list--grid');
  try { window.localStorage.setItem('sissi:admin:view', grid ? 'grid' : 'list'); } catch { /* ignore */ }
  applyView(grid);
});

// Poll every 5 s for playlist changes made elsewhere. Only the playlist list is re-rendered,
// and only when something actually changed. Paused while a drag or another action is running.
let lastPlaylistSig = null;
async function pollPlaylist() {
  if (!state.selectedId || dragFromIndex !== null || state.busy) return;
  try {
    const data = await apiFetch('/admin/screens', { redirectOn401: false });
    if (Number.isFinite(data?.serverTime)) state.clockOffsetMs = data.serverTime - Date.now();
    const next = data?.screens ?? [];
    const cur = next.find((sc) => sc.id === state.selectedId);
    if (!cur) return;
    const sig = `${cur.playlistVersion}|${JSON.stringify(cur.entries ?? [])}`;
    if (sig === lastPlaylistSig) return;
    lastPlaylistSig = sig;
    state.screens = next;
    els.playlistVersion.textContent = `v${cur.playlistVersion ?? 0}`;
    renderEntries(cur);
  } catch {
    // Keep the current list; the next poll tries again.
  }
}
setInterval(pollPlaylist, 5000);

async function handleUpload(file) {
  if (!file) return;
  const screen = getSelectedScreen();
  if (!screen) return;
  setStatus('Uploading…');
  try {
    const title = file.name.replace(/\.png$/i, '').slice(0, 200) || 'Uploaded PNG';
    const res = await fetch(apiUrl(base, `/admin/screens/${encodeURIComponent(screen.id)}/uploads`), {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'image/png',
        'X-Sissi-Admin': '1',
        'X-Upload-Title': encodeURIComponent(title),
      },
      body: file,
    });
    let data = null;
    if (res.status !== 204 && (res.headers.get('content-type') || '').includes('application/json')) {
      data = await res.json().catch(() => null);
    }
    if (!res.ok) {
      if (res.status === 401) showLogin(extractErrorMessage(data, 'Sign in again'));
      throw new Error(extractErrorMessage(data, `Upload failed (${res.status})`));
    }
    setStatus('Uploaded. The entry is added disabled; enable it to put it on screen.');
    await loadScreens();
  } catch (err) {
    setError(err.message);
  }
}

document.getElementById('upload-input')?.addEventListener('change', (event) => {
  const input = event.currentTarget;
  handleUpload(input.files?.[0]);
  input.value = '';
});

function render() {
  renderScreensList();
  renderDetail();
}

async function loadScreens() {
  const data = await apiFetch('/admin/screens');
  if (Number.isFinite(data?.serverTime)) state.clockOffsetMs = data.serverTime - Date.now();
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
    const p = screen.power ?? {};
    els.screenPowerDriver.value = p.driver ?? 'none';
    els.screenPowerLanId.value = p.lanId ?? '';
    els.screenPowerRouterId.value = p.routerId ?? '';
    els.screenPowerTimezone.value = p.schedule?.timezone ?? '';
    els.screenPowerMac.value = p.mac ?? '';
    els.screenPowerIp.value = p.ip ?? '';
    els.screenPowerWindows.value = formatScheduleWindows(p.schedule?.windows);
  } else {
    els.screenIdField.hidden = false;
    els.screenId.disabled = false;
    els.screenId.required = true;
    els.screenForm.reset();
    els.screenOrientation.value = 'landscape';
    els.screenDefaultSeconds.value = '10';
    els.screenPowerDriver.value = 'none';
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

async function handleSetEntryEnabled(screenId, entryId, enabled) {
  setError('');
  setStatus('');
  state.busy = true;
  render();
  try {
    await apiFetch(`/admin/screens/${encodeURIComponent(screenId)}/entries/${encodeURIComponent(entryId)}`, {
      method: 'PATCH',
      body: { enabled },
    });
    await loadScreens();
    setStatus(enabled ? 'Entry is live.' : 'Entry taken off the screen.');
  } catch (err) {
    setError(err.message);
  } finally {
    state.busy = false;
    render();
  }
}

async function handleSetPushEnabled(screenId, pushId, enabled) {
  setError('');
  setStatus('');
  state.busy = true;
  render();
  try {
    await apiFetch(`/admin/screens/${encodeURIComponent(screenId)}/pushes/${encodeURIComponent(pushId)}`, {
      method: 'PATCH',
      body: { enabled },
    });
    await loadScreens();
    setStatus(enabled ? `Push ${pushId} is live.` : `Push ${pushId} taken off the screen.`);
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

els.powerOverrideGroup.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-power-override]');
  if (!btn) return;
  const screen = getSelectedScreen();
  if (!screen) return;
  const override = btn.dataset.powerOverride;
  setError('');
  setStatus('');
  state.busy = true;
  render();
  try {
    await apiFetch(`/admin/screens/${encodeURIComponent(screen.id)}/power/override`, {
      method: 'POST',
      body: { override },
    });
    await loadScreens();
    setStatus(`Power override set to ${override}.`);
  } catch (err) {
    setError(err.message);
  } finally {
    state.busy = false;
    render();
  }
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
  const existingScreen = isCreate ? null : state.screens.find((s) => s.id === state.editingId);
  let payload;
  try {
    payload = buildScreenPayload(
      {
        id: els.screenId.value,
        name: els.screenName.value,
        orientation: els.screenOrientation.value,
        width: els.screenWidth.value,
        height: els.screenHeight.value,
        defaultImageSeconds: els.screenDefaultSeconds.value,
        maxVideoSeconds: els.screenMaxVideo.value,
        powerDriver: els.screenPowerDriver.value,
        powerLanId: els.screenPowerLanId.value,
        powerRouterId: els.screenPowerRouterId.value,
        powerTimezone: els.screenPowerTimezone.value,
        powerMac: els.screenPowerMac.value,
        powerIp: els.screenPowerIp.value,
        powerWindows: els.screenPowerWindows.value,
        powerOverride: existingScreen?.power?.override ?? 'auto',
      },
      { isCreate },
    );
  } catch (err) {
    showBanner(els.screenFormError, err.message);
    return;
  }

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

// Show the Tunnus button only where this install offers it.
(async () => {
  try {
    const cfg = await apiFetch('/admin/auth-config', { redirectOn401: false });
    if (cfg?.tunnus) {
      const link = document.getElementById('tunnus-login');
      if (link) {
        link.href = `${base}/admin/login`;
        link.hidden = false;
      }
    }
    if (cfg && cfg.password === false) {
      document.getElementById('login-form')?.setAttribute('hidden', '');
    }
  } catch {
    // Keep the password form if the config cannot be read.
  }
})();

// Initial bootstrap
loadScreens().catch((err) => {
  if (err.status !== 401) {
    showLogin(err.message);
  }
});
