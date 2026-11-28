import {
  apiUrl,
  buildScreenPayload,
  extractErrorMessage,
  formatAddedAt,
  formatScheduleWindows,
  previewUrl,
  reorderedEntryIds,
  resolveBasePath,
  rightsKeysFor,
} from './helpers.js';

if (typeof customElements !== 'undefined' && !customElements.get('copy-button')) {
  customElements.define(
    'copy-button',
    class extends HTMLElement {
      #timer = 0;
      connectedCallback() {
        this.addEventListener('command', (e) => {
          if (e.command === '--copy') this.#copy(e.source);
        });
        this.addEventListener('click', (e) => {
          const btn = e.target?.closest?.('button[command="--copy"]');
          if (btn && !('command' in HTMLButtonElement.prototype)) this.#copy(btn);
        });
      }
      async #copy(source) {
        const targetId = source?.getAttribute?.('commandfor');
        const target = targetId ? document.getElementById(targetId) : null;
        const text = target ? ('value' in target ? target.value : target.textContent) : '';
        if (!text || !navigator.clipboard?.writeText) return;
        try {
          await navigator.clipboard.writeText(text.trim());
          const tip = this.querySelector('.tip');
          if (tip) {
            tip.textContent = 'Copied';
            clearTimeout(this.#timer);
            this.#timer = setTimeout(() => {
              tip.textContent = '';
            }, 1500);
          }
        } catch {
          // Clipboard permission denied
        }
      }
    },
  );
}

const base = resolveBasePath(location.pathname);

const state = {
  // Server clock minus local clock (ms), from the last screens fetch; used for the now-playing marker.
  clockOffsetMs: 0,
  screens: [],
  screenFilter: '',
  viewFilter: '',
  viewType: '',
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
  screensFilter: document.getElementById('screens-filter'),
  viewsCount: document.getElementById('views-count'),
  viewsList: document.getElementById('views-list'),
  viewsEmpty: document.getElementById('views-empty'),
  viewsFilter: document.getElementById('views-filter'),
  viewsType: document.getElementById('views-type'),
  purgeExpiredBtn: document.getElementById('purge-expired-btn'),

  noSelection: document.getElementById('no-selection'),
  screenDetail: document.getElementById('screen-detail'),
  detailName: document.getElementById('detail-name'),
  detailThumb: document.getElementById('detail-thumb'),
  detailId: document.getElementById('detail-id'),
  detailMeta: document.getElementById('detail-meta'),
  powerBadge: document.getElementById('power-badge'),
  powerOverrideGroup: document.getElementById('power-override-group'),
  previewLink: document.getElementById('preview-link'),
  editScreenBtn: document.getElementById('edit-screen-btn'),
  deleteScreenBtn: document.getElementById('delete-screen-btn'),

  playlistSection: document.getElementById('playlist-section'),
  playlistVersion: document.getElementById('playlist-version'),
  playlistEmpty: document.getElementById('playlist-empty'),
  entriesList: document.getElementById('entries-list'),

  embedSection: document.getElementById('embed-section'),
  embedSummary: document.getElementById('embed-summary'),
  aggregateMembersSummary: document.getElementById('aggregate-members-summary'),
  embedScriptSnippet: document.getElementById('embed-script-snippet'),
  embedIframeSnippet: document.getElementById('embed-iframe-snippet'),
  rightsSection: document.getElementById('rights-section'),
  rightsKeysList: document.getElementById('rights-keys-list'),

  screenDialog: document.getElementById('screen-dialog'),
  screenDialogTitle: document.getElementById('screen-dialog-title'),
  screenDialogClose: document.getElementById('screen-dialog-close'),
  screenDialogCancel: document.getElementById('screen-dialog-cancel'),
  screenDialogSubmit: document.getElementById('screen-dialog-submit'),
  screenForm: document.getElementById('screen-form'),
  screenFormError: document.getElementById('screen-form-error'),
  screenKind: document.getElementById('screen-kind'),
  screenIdField: document.getElementById('screen-id-field'),
  screenId: document.getElementById('screen-id'),
  screenName: document.getElementById('screen-name'),
  screenOrientation: document.getElementById('screen-orientation'),
  screenWidth: document.getElementById('screen-width'),
  screenHeight: document.getElementById('screen-height'),
  screenDefaultSeconds: document.getElementById('screen-default-seconds'),
  screenMaxVideo: document.getElementById('screen-max-video'),
  embedFieldset: document.getElementById('embed-fieldset'),
  embedType: document.getElementById('embed-type'),
  embedFit: document.getElementById('embed-fit'),
  embedAspect: document.getElementById('embed-aspect'),
  embedDots: document.getElementById('embed-dots'),
  embedFitContent: document.getElementById('embed-fit-content'),
  embedAutoplay: document.getElementById('embed-autoplay'),
  embedOrigins: document.getElementById('embed-origins'),
  aggregateMembersField: document.getElementById('aggregate-members-field'),
  embedMembers: document.getElementById('embed-members'),
  powerFieldset: document.getElementById('power-fieldset'),
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

function isViewKind(screen) {
  const kind = screen.kind ?? 'screen';
  return kind === 'view' || kind === 'aggregate';
}

/** Fills one sidebar list (screens or views) with `items`. `total` is the unfiltered size, for the empty note. */
function renderSidebarList({ listEl, countEl, emptyEl, items, total, filtered }) {
  countEl.textContent = filtered ? `${items.length}/${total}` : String(total);
  emptyEl.hidden = items.length > 0;
  if (items.length === 0 && total > 0) emptyEl.textContent = 'Nothing matches the filter.';
  listEl.replaceChildren();

  for (const screen of items) {
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
    const kindLabel = screen.kind && screen.kind !== 'screen' ? `${screen.kind} · ` : '';
    sub.textContent = `${screen.id} · ${kindLabel}${screen.orientation} · ${dims}`;

    btn.append(title, sub);
    li.append(btn);
    listEl.append(li);
  }
}

function renderScreensList() {
  const query = state.screenFilter.trim().toLowerCase();
  const all = state.screens.filter((s) => !isViewKind(s));
  const items = query
    ? all.filter((s) => `${s.name} ${s.id}`.toLowerCase().includes(query))
    : all;
  els.screensEmpty.textContent = 'No screens yet.';
  renderSidebarList({
    listEl: els.screensList,
    countEl: els.screensCount,
    emptyEl: els.screensEmpty,
    items,
    total: all.length,
    filtered: Boolean(query),
  });

  const allViews = state.screens.filter(isViewKind);
  const viewQuery = state.viewFilter.trim().toLowerCase();
  const views = allViews.filter((s) => {
    const matchesText = !viewQuery || `${s.name} ${s.id}`.toLowerCase().includes(viewQuery);
    const matchesType = !state.viewType || s.kind === state.viewType;
    return matchesText && matchesType;
  });
  els.viewsEmpty.textContent = 'No views yet.';
  renderSidebarList({
    listEl: els.viewsList,
    countEl: els.viewsCount,
    emptyEl: els.viewsEmpty,
    items: views,
    total: allViews.length,
    filtered: Boolean(viewQuery || state.viewType),
  });
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
  const kind = screen.kind ?? 'screen';
  const isViewLike = kind === 'view' || kind === 'aggregate';
  const dims = screen.width && screen.height ? `${screen.width}×${screen.height}px` : 'auto size';
  const maxVid = screen.maxVideoSeconds ? `max video ${screen.maxVideoSeconds}s` : 'no video limit';
  els.detailMeta.textContent = `${kind} · ${screen.orientation} · ${dims} · default image ${screen.defaultImageSeconds}s · ${maxVid}`;
  els.previewLink.href = previewUrl(base, screen.id, kind);
  els.previewLink.textContent = isViewLike ? 'Preview view ↗' : 'Preview screen ↗';
  els.playlistVersion.textContent = `v${screen.playlistVersion ?? 0}`;

  if (els.embedSection) {
    els.embedSection.hidden = !isViewLike;
    if (isViewLike) {
      const origin = location.origin;
      const encoded = encodeURIComponent(screen.id);
      const embed = screen.embed ?? {};
      const opts = embed.options ?? {};
      const origins = embed.allowedOrigins ?? [];
      els.embedSummary.textContent = `${embed.type ?? 'carousel'} · ${opts.aspect ?? '16:9'} · ${opts.fit ?? 'contain'} · ${origins.length} origin(s)`;
      els.embedScriptSnippet.value = `<script src="${origin}${base}/v/${encoded}/embed.js"></script>`;
      const aspectCss = String(opts.aspect ?? '16:9').replace(':', '/');
      // The small script hides the frame while the view has nothing to show (the frame page tells its parent).
      const hideEmpty = `<script>addEventListener('message',function(e){var d=e.data;if(!d||d.sissi!=='empty')return;var f=document.querySelectorAll('iframe[src*="/v/${encoded}/frame"]');for(var i=0;i<f.length;i++)if(f[i].contentWindow===e.source)f[i].style.display=d.empty?'none':'';});</script>`;
      els.embedIframeSnippet.value = `<iframe src="${origin}${base}/v/${encoded}/frame" title="${screen.name}" style="width:100%;aspect-ratio:${aspectCss};border:0" loading="eager"></iframe>${hideEmpty}`;
      if (kind === 'aggregate') {
        els.aggregateMembersSummary.hidden = false;
        els.aggregateMembersSummary.textContent = `Members: ${(screen.members ?? []).join(', ') || 'none'}`;
      } else {
        els.aggregateMembersSummary.hidden = true;
      }
    }
  }

  if (els.rightsSection && els.rightsKeysList) {
    els.rightsSection.hidden = false;
    els.rightsKeysList.replaceChildren();
    for (const key of rightsKeysFor(screen.id, kind)) {
      const row = document.createElement('div');
      row.className = 'copy-row';
      const code = document.createElement('code');
      const codeId = `rk-${key.replace(/[^a-z0-9_-]/gi, '-')}`;
      code.id = codeId;
      code.textContent = key;
      const cb = document.createElement('copy-button');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-sm';
      btn.setAttribute('command', '--copy');
      btn.setAttribute('commandfor', codeId);
      btn.textContent = 'Copy';
      const tip = document.createElement('span');
      tip.className = 'tip muted';
      tip.setAttribute('role', 'status');
      tip.setAttribute('aria-live', 'polite');
      cb.append(btn, tip);
      row.append(code, cb);
      els.rightsKeysList.append(row);
    }
  }

  if (els.playlistSection) {
    els.playlistSection.hidden = kind === 'aggregate';
  }

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

/** Image entries show themselves; video entries show their first-frame thumbnail when one exists. */
function thumbUrlFor(entry) {
  if (entry.kind === 'video' && entry.thumbMediaId) {
    return `${base}/media/${entry.thumbMediaId}.${entry.thumbExt || 'png'}`;
  }
  return mediaUrlFor(entry);
}

function thumbFor(entry) {
  const fallback = () => createKindIcon(entry.kind);
  let media;
  if (entry.kind === 'video' && !entry.thumbMediaId) {
    // No stored first-frame image: let the browser show the video's first frame.
    media = document.createElement('video');
    media.muted = true;
    media.playsInline = true;
    media.preload = 'metadata';
    media.tabIndex = -1;
    media.src = `${mediaUrlFor(entry)}#t=0.1`;
  } else {
    media = document.createElement('img');
    media.alt = '';
    media.loading = 'lazy';
    media.decoding = 'async';
    media.src = thumbUrlFor(entry);
  }
  media.className = 'entry-thumb';
  media.addEventListener('error', () => media.replaceWith(fallback()));
  const link = document.createElement('a');
  link.className = 'entry-thumb-link';
  link.href = mediaUrlFor(entry);
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.title = 'Open full size';
  link.setAttribute('aria-label', `Open ${entry.title || entry.entryId} full size`);
  link.append(media);
  return link;
}

/** 'live' | 'scheduled' | 'ended' | 'disabled', by the server clock (the browser clock plus the measured offset). */
function entryStatus(entry, nowMs = Date.now() + state.clockOffsetMs) {
  if (entry.enabled === false) return 'disabled';
  const start = entry.startDatetime ? Date.parse(entry.startDatetime) : null;
  const end = entry.endDatetime ? Date.parse(entry.endDatetime) : null;
  if (end !== null && end <= nowMs) return 'ended';
  if (start !== null && start > nowMs) return 'scheduled';
  return 'live';
}

function expiredCount(screen) {
  const nowMs = Date.now() + state.clockOffsetMs;
  return (screen?.entries ?? []).filter((e) => e.endDatetime && Date.parse(e.endDatetime) <= nowMs).length;
}

/** ISO instant to the value format of <input type="datetime-local"> (local time). */
function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function fromLocalInput(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Draws one frame of a video file to a PNG blob (max 640 px wide). Seeks slightly in, since
 * many encoders start on a black frame. Runs entirely in the browser: no server-side ffmpeg.
 */
function captureVideoFrame(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    const finish = (fn, value) => {
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
      fn(value);
    };
    const draw = () => {
      const srcW = video.videoWidth || 640;
      const srcH = video.videoHeight || 360;
      const scale = Math.min(1, 640 / srcW);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(srcW * scale));
      canvas.height = Math.max(1, Math.round(srcH * scale));
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => (blob ? finish(resolve, blob) : finish(reject, new Error('Could not encode the thumbnail'))),
        'image/png',
      );
    };
    video.onerror = () => finish(reject, new Error('Could not read the video for a thumbnail'));
    video.onloadeddata = () => {
      const target = Math.min(0.1, (video.duration || 0) / 2);
      if (target > 0) {
        video.onseeked = draw;
        video.currentTime = target;
      } else {
        draw();
      }
    };
    video.src = url;
  });
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

// Entry ids whose details are open. Kept outside renderEntries so polling and re-renders do not collapse them.
const openEntries = new Set();

function formatWhen(value) {
  if (!value) return 'â€”';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? 'â€”' : d.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
}

function entrySection(title, ...nodes) {
  const section = document.createElement('section');
  section.className = 'entry-section';
  const heading = document.createElement('h4');
  heading.textContent = title;
  section.append(heading, ...nodes);
  return section;
}

function entryField(labelText, input) {
  const label = document.createElement('label');
  label.className = 'entry-field';
  const text = document.createElement('span');
  text.textContent = labelText;
  label.append(text, input);
  return label;
}

function entryButton(text, className, handler, disabled) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = className;
  btn.textContent = text;
  btn.disabled = Boolean(disabled);
  btn.addEventListener('click', handler);
  return btn;
}

function renderEntries(screen) {
  const entries = screen.entries ?? [];
  updatePurgeButton(screen);
  els.playlistEmpty.hidden = entries.length > 0;
  els.entriesList.replaceChildren();

  entries.forEach((entry, index) => {
    const li = document.createElement('li');
    const status = entryStatus(entry);
    const isOpen = openEntries.has(entry.entryId);
    li.className = `entry-row${status === 'live' ? '' : ' entry-disabled'}${isOpen ? ' is-open' : ''}`;
    const title = entry.title || entry.entryId;

    // ---- Summary row (always visible): drag handle, now marker, number, name, enable on, disable on ----
    const summary = document.createElement('div');
    summary.className = 'entry-summary';

    const grip = document.createElement('span');
    grip.className = 'drag-grip';
    grip.textContent = 'â ¿';
    grip.title = 'Drag to reorder';
    grip.setAttribute('aria-hidden', 'true');
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

    const nowBadge = document.createElement('span');
    nowBadge.className = 'now-badge';
    nowBadge.textContent = 'â–¶';
    nowBadge.title = 'Now playing';
    nowBadge.setAttribute('role', 'img');
    nowBadge.setAttribute('aria-label', 'Now playing');
    nowBadge.hidden = true;
    const nowSlot = document.createElement('span');
    nowSlot.className = 'now-slot';
    nowSlot.append(nowBadge);

    const num = document.createElement('span');
    num.className = 'entry-num';
    num.textContent = String(index + 1);

    const titleEl = document.createElement('span');
    titleEl.className = 'entry-title';
    titleEl.textContent = title;
    titleEl.title = title;

    const whenFrom = document.createElement('span');
    whenFrom.className = 'entry-when';
    whenFrom.title = 'Enable on';
    whenFrom.textContent = `On: ${formatWhen(entry.startDatetime)}`;
    const whenUntil = document.createElement('span');
    whenUntil.className = 'entry-when';
    whenUntil.title = 'Disable on';
    whenUntil.textContent = `Off: ${formatWhen(entry.endDatetime)}`;

    const detailsId = `entry-details-${entry.entryId}`;
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'entry-toggle';
    toggle.setAttribute('aria-expanded', String(isOpen));
    toggle.setAttribute('aria-controls', detailsId);
    toggle.setAttribute('aria-label', `Settings for ${title}`);
    toggle.title = 'Show settings';
    toggle.textContent = 'â–¸';

    // Enabled toggle: the whole 'is this item on' question in one box. Setting visibility times switches it on.
    const enabledBox = document.createElement('input');
    enabledBox.type = 'checkbox';
    enabledBox.className = 'entry-enabled';
    enabledBox.checked = entry.enabled !== false;
    enabledBox.disabled = state.busy;
    enabledBox.title = { live: 'Enabled and showing', scheduled: 'Enabled, waiting for its start time', ended: 'Enabled, but its end time has passed', disabled: 'Disabled' }[status];
    enabledBox.setAttribute('aria-label', `Enabled: ${title}`);
    enabledBox.addEventListener('change', () => handleSetEntryEnabled(screen.id, entry.entryId, enabledBox.checked));

    summary.append(grip, enabledBox, nowSlot, num, titleEl, whenFrom, whenUntil, toggle);

    // ---- Details (collapsed by default): every per-item setting, grouped ----
    const details = document.createElement('div');
    details.className = 'entry-details';
    details.id = detailsId;
    details.hidden = !isOpen;

    toggle.addEventListener('click', () => {
      const open = details.hidden;
      details.hidden = !open;
      li.classList.toggle('is-open', open);
      toggle.setAttribute('aria-expanded', String(open));
      if (open) openEntries.add(entry.entryId); else openEntries.delete(entry.entryId);
    });

    // Overview: preview, kind, status, added
    const preview = document.createElement('div');
    preview.className = 'entry-preview';
    const liveBadge = document.createElement('span');
    liveBadge.className = `badge status-${status}`;
    liveBadge.textContent = { live: 'Live', scheduled: 'Scheduled', ended: 'Ended', disabled: 'Disabled' }[status];
    const kindEl = document.createElement('span');
    kindEl.className = 'muted';
    kindEl.textContent = entry.kind === 'video' ? 'Video' : 'Image';
    const addedEl = document.createElement('span');
    addedEl.className = 'muted';
    addedEl.textContent = formatAddedAt(entry.addedAt);
    const previewMeta = document.createElement('div');
    previewMeta.className = 'entry-preview-meta';
    previewMeta.append(liveBadge, kindEl, addedEl);
    preview.append(thumbFor(entry), previewMeta);

    // Playback: duration (on/off is the checkbox in the summary row)
    const playbackNodes = [];
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
      secInput.setAttribute('aria-label', `Seconds for ${title}`);
      const unit = document.createElement('span');
      unit.className = 'muted';
      unit.textContent = 's';
      const saveBtn = document.createElement('button');
      saveBtn.type = 'submit';
      saveBtn.className = 'btn btn-sm';
      saveBtn.textContent = 'Save';
      saveBtn.disabled = state.busy;
      secForm.append(entryField('Show for', secInput), unit, saveBtn);
      secForm.addEventListener('submit', (e) => {
        e.preventDefault();
        handleUpdateSeconds(screen.id, entry.entryId, secInput.value);
      });
      playbackNodes.push(secForm);
    } else {
      const dur = document.createElement('span');
      dur.className = 'badge';
      dur.textContent = `${entry.seconds}s (video)`;
      playbackNodes.push(dur);
    }

    // Schedule: enable on / disable on
    const schedForm = document.createElement('form');
    schedForm.className = 'entry-schedule';
    const mkDate = (labelText, value) => {
      const input = document.createElement('input');
      input.type = 'datetime-local';
      input.value = toLocalInput(value);
      return { field: entryField(labelText, input), input };
    };
    const from = mkDate('Enable on', entry.startDatetime);
    const until = mkDate('Disable on', entry.endDatetime);
    const saveSchedBtn = document.createElement('button');
    saveSchedBtn.type = 'submit';
    saveSchedBtn.className = 'btn btn-sm';
    saveSchedBtn.textContent = 'Save times';
    saveSchedBtn.disabled = state.busy;
    schedForm.append(from.field, until.field, saveSchedBtn);
    schedForm.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const startVal = fromLocalInput(from.input.value);
      const endVal = fromLocalInput(until.input.value);
      // Giving the item a visibility window switches it on (the window then decides when it shows).
      handleSaveSchedule(screen.id, entry.entryId, startVal, endVal, entry.enabled === false && Boolean(startVal || endVal));
    });

    const sections = [
      entrySection('Overview', preview),
      entrySection('Playback', ...playbackNodes),
      entrySection('Schedule', schedForm),
    ];

    // Text (views only)
    if (screen.kind === 'view') {
      const textForm = document.createElement('form');
      textForm.className = 'entry-text-form';
      const mkText = (type, max, value) => {
        const input = document.createElement('input');
        input.type = type;
        input.maxLength = max;
        input.value = value ?? '';
        return input;
      };
      const headlineInput = mkText('text', 120, entry.headline);
      const captionInput = mkText('text', 500, entry.caption);
      const altInput = mkText('text', 300, entry.alt);
      const linkInput = mkText('url', 2048, entry.link);
      linkInput.placeholder = 'https://â€¦';
      const saveTextBtn = document.createElement('button');
      saveTextBtn.type = 'submit';
      saveTextBtn.className = 'btn btn-sm';
      saveTextBtn.textContent = 'Save text';
      saveTextBtn.disabled = state.busy;
      textForm.append(
        entryField('Heading', headlineInput),
        entryField('Caption', captionInput),
        entryField('Alt text', altInput),
        entryField('Link', linkInput),
        saveTextBtn,
      );
      textForm.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        setError('');
        setStatus('');
        state.busy = true;
        render();
        try {
          await apiFetch(`/admin/screens/${encodeURIComponent(screen.id)}/entries/${encodeURIComponent(entry.entryId)}`, {
            method: 'PATCH',
            body: {
              headline: headlineInput.value || null,
              alt: altInput.value || null,
              caption: captionInput.value || null,
              link: linkInput.value || null,
            },
          });
          await loadScreens();
          setStatus('Entry text updated.');
        } catch (err) {
          setError(err.message);
        } finally {
          state.busy = false;
          render();
        }
      });
      sections.push(entrySection('Text', textForm));
    }

    // Push group: one upload can add several items; this switches all of them together.
    const pushItems = entries.filter((e) => e.pushId === entry.pushId);
    const pushAllOn = pushItems.every((e) => e.enabled !== false);
    const pushBox = document.createElement('input');
    pushBox.type = 'checkbox';
    pushBox.checked = pushAllOn;
    pushBox.disabled = state.busy;
    pushBox.addEventListener('change', () => handleSetPushEnabled(screen.id, entry.pushId, pushBox.checked));
    const pushLabel = document.createElement('label');
    pushLabel.className = 'checkbox-inline';
    pushLabel.append(pushBox, pushItems.length > 1 ? ` Enabled (all ${pushItems.length} items from this upload)` : ' Enabled');
    const pushBadge = document.createElement('code');
    pushBadge.className = 'code-pill';
    pushBadge.textContent = entry.pushId;
    const pushGroup = document.createElement('div');
    pushGroup.className = 'push-group';
    pushGroup.append(
      pushLabel,
      pushBadge,
      entryButton(pushItems.length > 1 ? `Remove all ${pushItems.length} items` : 'Remove', 'btn btn-sm btn-danger', () => handleRemovePush(screen.id, entry.pushId), state.busy),
    );
    sections.push(entrySection('Upload', pushGroup));

    // Order and delete
    const upBtn = entryButton('â†‘ Up', 'btn btn-sm', () => handleReorder(screen.id, entries, index, -1), index === 0 || state.busy);
    upBtn.setAttribute('aria-label', `Move ${title} up`);
    const downBtn = entryButton('â†“ Down', 'btn btn-sm', () => handleReorder(screen.id, entries, index, 1), index === entries.length - 1 || state.busy);
    downBtn.setAttribute('aria-label', `Move ${title} down`);
    const actions = document.createElement('div');
    actions.className = 'entry-actions';
    actions.append(upBtn, downBtn, entryButton('Delete', 'btn btn-sm btn-danger', () => handleDeleteEntry(screen.id, entry.entryId), state.busy));
    sections.push(entrySection('Order and removal', actions));

    details.append(...sections);
    li.append(summary, details);
    li.dataset.entryId = entry.entryId;
    li.dataset.index = String(index);
    els.entriesList.append(li);
  });
  updateNowPlaying();
}


/** Marks the entry every screen is playing at this moment. Same arithmetic as the player (src/playback/schedule.mjs). */
function updateNowPlaying() {
  const screen = getSelectedScreen();
  const entries = (screen?.entries ?? []).filter((e) => entryStatus(e) === 'live');
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
  updateDetailThumb(screen, (screen?.entries ?? []).find((e) => e.entryId === playingId) ?? entries[0] ?? null);
}

/** Small preview next to the screen heading: what is showing now (or the first live item). */
function updateDetailThumb(screen, entry) {
  const box = els.detailThumb;
  if (!box) return;
  const key = screen && entry ? `${screen.id}/${entry.entryId}` : '';
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  box.replaceChildren();
  box.hidden = !key;
  if (key) box.append(thumbFor(entry));
}

setInterval(updateNowPlaying, 1000);

async function handleSaveSchedule(screenId, entryId, startDatetime, endDatetime, enable = false) {
  setError('');
  setStatus('');
  state.busy = true;
  render();
  try {
    await apiFetch(`/admin/screens/${encodeURIComponent(screenId)}/entries/${encodeURIComponent(entryId)}`, {
      method: 'PATCH',
      body: enable ? { startDatetime, endDatetime, enabled: true } : { startDatetime, endDatetime },
    });
    await loadScreens();
    setStatus(enable ? 'Visibility times saved and the item enabled.' : 'Visibility times saved.');
  } catch (err) {
    setError(err.message);
  } finally {
    state.busy = false;
    render();
  }
}

async function handlePurgeExpired() {
  const screen = getSelectedScreen();
  if (!screen) return;
  const count = expiredCount(screen);
  if (count === 0) return;
  const confirmed = await confirmAction({
    title: 'Clear expired content?',
    message: `Remove ${count} ${count === 1 ? 'entry' : 'entries'} whose end time has passed from "${screen.name}"? This cannot be undone.`,
    okLabel: 'Remove expired',
  });
  if (!confirmed) return;

  setError('');
  setStatus('');
  state.busy = true;
  render();
  try {
    const data = await apiFetch(`/admin/screens/${encodeURIComponent(screen.id)}/purge-expired`, {
      method: 'POST',
      body: {},
    });
    await loadScreens();
    setStatus(`Removed ${data?.removed ?? 0} expired ${data?.removed === 1 ? 'entry' : 'entries'}.`);
  } catch (err) {
    setError(err.message);
  } finally {
    state.busy = false;
    render();
  }
}
els.purgeExpiredBtn?.addEventListener('click', handlePurgeExpired);
els.screensFilter?.addEventListener('input', () => {
  state.screenFilter = els.screensFilter.value;
  renderScreensList();
});
els.viewsFilter?.addEventListener('input', () => {
  state.viewFilter = els.viewsFilter.value;
  renderScreensList();
});
els.viewsType?.addEventListener('change', () => {
  state.viewType = els.viewsType.value;
  renderScreensList();
});

function updatePurgeButton(screen) {
  if (!els.purgeExpiredBtn) return;
  const n = expiredCount(screen);
  els.purgeExpiredBtn.disabled = state.busy || n === 0;
  els.purgeExpiredBtn.textContent = n > 0 ? `Clear expired (${n})` : 'Clear expired';
}

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
    const sig = `${cur.playlistVersion}|${JSON.stringify(cur.entries ?? [])}|${(cur.entries ?? []).map((e) => entryStatus(e)).join(',')}`;
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
  const isVideo = file.type === 'video/mp4' || /\.mp4$/i.test(file.name);
  setStatus('Uploading…');
  try {
    const title = file.name.replace(/\.(png|mp4)$/i, '').slice(0, 200) || (isVideo ? 'Uploaded video' : 'Uploaded PNG');
    const res = await fetch(apiUrl(base, `/admin/screens/${encodeURIComponent(screen.id)}/uploads`), {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': isVideo ? 'video/mp4' : 'image/png',
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
    let message = 'Uploaded. The entry is added disabled; enable it to put it on screen.';
    if (isVideo && data?.entry?.entryId) {
      try {
        const thumb = await captureVideoFrame(file);
        const tRes = await fetch(
          apiUrl(base, `/admin/screens/${encodeURIComponent(screen.id)}/entries/${encodeURIComponent(data.entry.entryId)}/thumbnail`),
          {
            method: 'PUT',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'image/png', 'X-Sissi-Admin': '1' },
            body: thumb,
          },
        );
        if (!tRes.ok) throw new Error(`thumbnail ${tRes.status}`);
      } catch (thumbErr) {
        message = `Uploaded without a thumbnail (${thumbErr.message}). The entry is added disabled; enable it to put it on screen.`;
      }
    }
    setStatus(message);
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

function syncKindFields(kind) {
  const isViewLike = kind === 'view' || kind === 'aggregate';
  if (els.embedFieldset) els.embedFieldset.hidden = !isViewLike;
  if (els.powerFieldset) els.powerFieldset.hidden = isViewLike;
  if (els.aggregateMembersField) els.aggregateMembersField.hidden = kind !== 'aggregate';
}

function openScreenDialog(screen = null) {
  state.editingId = screen ? screen.id : null;
  showBanner(els.screenFormError, '');
  els.screenDialogTitle.textContent = screen ? `Edit ${screen.kind ?? 'screen'}: ${screen.id}` : 'Create';

  if (screen) {
    const kind = screen.kind ?? 'screen';
    if (els.screenKind) {
      els.screenKind.value = kind;
      els.screenKind.disabled = true;
    }
    syncKindFields(kind);
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
    const emb = screen.embed ?? {};
    const embOpts = emb.options ?? {};
    if (els.embedType) els.embedType.value = emb.type ?? 'carousel';
    if (els.embedFit) els.embedFit.value = embOpts.fit ?? 'contain';
    if (els.embedAspect) els.embedAspect.value = embOpts.aspect ?? '16:9';
    if (els.embedDots) els.embedDots.checked = embOpts.dots !== false;
    if (els.embedFitContent) els.embedFitContent.checked = embOpts.fitContent === true;
    if (els.embedAutoplay) els.embedAutoplay.checked = embOpts.autoplay !== false;
    if (els.embedOrigins) els.embedOrigins.value = (emb.allowedOrigins ?? []).join('\n');
    if (els.embedMembers) els.embedMembers.value = (screen.members ?? []).join(', ');
    const p = screen.power ?? {};
    els.screenPowerDriver.value = p.driver ?? 'none';
    els.screenPowerLanId.value = p.lanId ?? '';
    els.screenPowerRouterId.value = p.routerId ?? '';
    els.screenPowerTimezone.value = p.schedule?.timezone ?? '';
    els.screenPowerMac.value = p.mac ?? '';
    els.screenPowerIp.value = p.ip ?? '';
    els.screenPowerWindows.value = formatScheduleWindows(p.schedule?.windows);
  } else {
    if (els.screenKind) {
      els.screenKind.disabled = false;
      els.screenKind.value = 'screen';
    }
    syncKindFields('screen');
    els.screenIdField.hidden = false;
    els.screenId.disabled = false;
    els.screenId.required = true;
    els.screenForm.reset();
    els.screenOrientation.value = 'landscape';
    els.screenDefaultSeconds.value = '10';
    if (els.embedType) els.embedType.value = 'carousel';
    if (els.embedFit) els.embedFit.value = 'contain';
    if (els.embedAspect) els.embedAspect.value = '16:9';
    if (els.embedDots) els.embedDots.checked = true;
    if (els.embedFitContent) els.embedFitContent.checked = false;
    if (els.embedAutoplay) els.embedAutoplay.checked = true;
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
els.screenKind?.addEventListener('change', () => syncKindFields(els.screenKind.value));

els.screenForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  showBanner(els.screenFormError, '');
  const isCreate = !state.editingId;
  const existingScreen = isCreate ? null : state.screens.find((s) => s.id === state.editingId);
  let payload;
  try {
    payload = buildScreenPayload(
      {
        kind: isCreate ? (els.screenKind?.value ?? 'screen') : (existingScreen?.kind ?? 'screen'),
        id: els.screenId.value,
        name: els.screenName.value,
        orientation: els.screenOrientation.value,
        width: els.screenWidth.value,
        height: els.screenHeight.value,
        defaultImageSeconds: els.screenDefaultSeconds.value,
        maxVideoSeconds: els.screenMaxVideo.value,
        embedType: els.embedType?.value,
        embedFit: els.embedFit?.value,
        embedAspect: els.embedAspect?.value,
        embedDots: els.embedDots?.checked,
        embedFitContent: els.embedFitContent?.checked,
        embedAutoplay: els.embedAutoplay?.checked,
        embedOrigins: els.embedOrigins?.value,
        members: els.embedMembers?.value,
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
        const separator = document.getElementById('auth-separator');
        if (separator) separator.hidden = false;
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
