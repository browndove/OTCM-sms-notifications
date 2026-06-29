const state = {
  campaign: null,
  recipients: [],
  filterStatus: 'all',
  searchTerm: ''
};

const el = (id) => document.getElementById(id);

// ---------- Upload ----------
const dropzone = el('dropzone');
const fileInput = el('fileInput');

el('browseBtn').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => {
  if (e.target.files[0]) handleFile(e.target.files[0]);
});

['dragenter', 'dragover'].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.add('is-dragover');
  })
);
['dragleave', 'drop'].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.remove('is-dragover');
  })
);
dropzone.addEventListener('drop', (e) => {
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
});

async function handleFile(file) {
  el('fileName').textContent = file.name;
  el('uploadError').hidden = true;

  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch('/api/upload', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload failed');

    state.campaign = data.campaign;
    state.recipients = data.recipients;
    renderSummary();
    renderTable();
    el('panel-summary').hidden = false;
    el('panel-table').hidden = false;
  } catch (err) {
    el('uploadError').textContent = err.message;
    el('uploadError').hidden = false;
  }
}

// ---------- Summary ----------
function renderSummary() {
  const r = state.recipients;
  const ready = r.filter((x) => x.sendStatus === 'pending' && !x.phoneIssue && x.message);
  const invalidPhone = r.filter((x) => x.phoneIssue);
  const incomplete = r.filter((x) => !x.phoneIssue && (!x.name || !x.license));

  el('summaryGrid').innerHTML = `
    <div class="summary-card summary-card--good">
      <div class="summary-card__num">${r.length}</div>
      <div class="summary-card__label">Total rows</div>
    </div>
    <div class="summary-card summary-card--good">
      <div class="summary-card__num">${ready.length}</div>
      <div class="summary-card__label">Ready to send</div>
    </div>
    <div class="summary-card summary-card--warn">
      <div class="summary-card__num">${invalidPhone.length}</div>
      <div class="summary-card__label">Missing / invalid phone</div>
    </div>
    <div class="summary-card summary-card--bad">
      <div class="summary-card__num">${incomplete.length}</div>
      <div class="summary-card__label">Incomplete rows</div>
    </div>
  `;

  const sample = ready[0] || r[0];
  el('sampleMessage').textContent = sample?.message || 'No valid rows to preview.';
  el('readyCount').textContent = `${ready.length} of ${r.length} recipients will be messaged`;
}

// ---------- Table ----------
function statusBadge(status) {
  const labels = {
    pending: 'Pending',
    queued: 'Sending\u2026',
    sent_ok: 'Sent',
    send_failed: 'Send failed',
    invalid_phone: 'Invalid phone',
    incomplete_row: 'Incomplete'
  };
  return `<span class="badge badge--${status}">${labels[status] || status}</span>`;
}

function deliveryBadge(row) {
  if (!row.deliveryStatus) return '<span class="badge badge--unknown">No report yet</span>';
  const s = row.deliveryStatus.toLowerCase();
  let cls = 'unknown';
  if (['delivered', 'success', 'sent'].includes(s)) cls = 'delivered';
  else if (['failed', 'undelivered', 'rejected', 'expired'].includes(s)) cls = 'failed';
  return `<span class="badge badge--${cls}">${row.deliveryStatus}</span>`;
}

function rowSendStatus(row) {
  if (row.phoneIssue) return 'invalid_phone';
  if (!row.name || !row.license) return 'incomplete_row';
  return row.sendStatus;
}

function renderTable() {
  const filtered = state.recipients.filter((row) => {
    const status = rowSendStatus(row);
    if (state.filterStatus !== 'all' && status !== state.filterStatus) return false;
    if (state.searchTerm) {
      const hay = `${row.name} ${row.license} ${row.phoneRaw} ${row.location}`.toLowerCase();
      if (!hay.includes(state.searchTerm)) return false;
    }
    return true;
  });

  el('recipientsBody').innerHTML = filtered
    .map((row) => {
      const phoneDisplay = row.phoneFormatted || row.phoneRaw || '\u2014';
      const canRetry = row.sendStatus === 'send_failed' || row.sendStatus === 'pending';
      const retryDisabled = row.phoneIssue || !row.message ? 'disabled' : '';
      return `
        <tr data-id="${row.id}">
          <td>${row.sn ?? ''}</td>
          <td>${escapeHtml(row.name)}</td>
          <td>${escapeHtml(row.location)}</td>
          <td class="license">${escapeHtml(row.license)}</td>
          <td class="phone">${escapeHtml(phoneDisplay)}</td>
          <td>${statusBadge(rowSendStatus(row))}</td>
          <td>${deliveryBadge(row)}</td>
          <td>${canRetry ? `<button class="btn btn--ghost btn--small retry-btn" ${retryDisabled} data-id="${row.id}">Send</button>` : ''}</td>
        </tr>
      `;
    })
    .join('');

  document.querySelectorAll('.retry-btn').forEach((btn) =>
    btn.addEventListener('click', () => sendOne(btn.dataset.id))
  );

  updateProgress();
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function updateProgress() {
  const sendable = state.recipients.filter((r) => !r.phoneIssue && r.message);
  const sent = sendable.filter((r) => r.sendStatus === 'sent_ok' || r.sendStatus === 'send_failed');
  const pct = sendable.length ? Math.round((sent.length / sendable.length) * 100) : 0;
  el('progressFill').style.width = pct + '%';
  const ok = sendable.filter((r) => r.sendStatus === 'sent_ok').length;
  const failed = sendable.filter((r) => r.sendStatus === 'send_failed').length;
  el('progressText').textContent = sendable.length
    ? `${sent.length} / ${sendable.length} attempted \u2014 ${ok} sent, ${failed} failed`
    : 'No sendable recipients found.';
}

// ---------- Filters ----------
el('searchBox').addEventListener('input', (e) => {
  state.searchTerm = e.target.value.trim().toLowerCase();
  renderTable();
});
el('filterStatus').addEventListener('change', (e) => {
  state.filterStatus = e.target.value;
  renderTable();
});

// ---------- Sending (throttled, sequential) ----------
async function sendOne(id) {
  const row = state.recipients.find((r) => r.id === id);
  if (!row || row.phoneIssue || !row.message) return;

  row.sendStatus = 'queued';
  renderTable();

  try {
    const res = await fetch(`/api/send/${id}`, { method: 'POST' });
    const data = await res.json();
    row.sendStatus = data.ok ? 'sent_ok' : 'send_failed';
    if (data.result?.data?.id) row.arkeselId = data.result.data.id;
  } catch (err) {
    row.sendStatus = 'send_failed';
  }
  renderTable();
}

let sendingAll = false;

el('sendAllBtn').addEventListener('click', async () => {
  if (sendingAll) return;
  const skipIssues = el('skipIssues').checked;
  const targets = state.recipients.filter((r) => {
    if (r.sendStatus === 'sent_ok') return false;
    if (skipIssues && (r.phoneIssue || !r.message)) return false;
    return !r.phoneIssue && r.message;
  });

  if (!targets.length) {
    alert('No sendable recipients found.');
    return;
  }
  if (!confirm(`Send SMS to ${targets.length} recipients now? This will use Arkesel credits.`)) {
    return;
  }

  sendingAll = true;
  el('sendAllBtn').disabled = true;
  el('sendAllBtn').textContent = `Sending\u2026 (0 / ${targets.length})`;

  let done = 0;
  for (const row of targets) {
    await sendOne(row.id);
    done += 1;
    el('sendAllBtn').textContent = `Sending\u2026 (${done} / ${targets.length})`;
    // Throttle to be gentle on the API and avoid rate limiting.
    await sleep(300);
  }

  el('sendAllBtn').textContent = 'Send to all ready recipients';
  el('sendAllBtn').disabled = false;
  sendingAll = false;
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------- Manual refresh of delivery statuses (poll fallback) ----------
el('refreshBtn').addEventListener('click', async () => {
  const sent = state.recipients.filter((r) => r.arkeselId && !r.deliveryStatus);
  if (!sent.length) {
    // Pull the latest from server in case webhook already updated things
    if (state.campaign) {
      const res = await fetch(`/api/campaigns/${state.campaign.id}/messages`);
      const data = await res.json();
      mergeServerMessages(data.messages);
      renderTable();
    }
    return;
  }
  el('refreshBtn').disabled = true;
  el('refreshBtn').textContent = 'Checking\u2026';
  for (const row of sent) {
    try {
      const res = await fetch(`/api/status/${row.id}`);
      const data = await res.json();
      const status = data?.data?.status || data?.status;
      if (status) row.deliveryStatus = status;
    } catch (e) {
      // ignore individual failures
    }
    await sleep(150);
  }
  el('refreshBtn').disabled = false;
  el('refreshBtn').textContent = 'Refresh statuses';
  renderTable();
});

function mergeServerMessages(serverMessages) {
  const byId = Object.fromEntries(serverMessages.map((m) => [m.id, m]));
  state.recipients = state.recipients.map((r) => ({ ...r, ...byId[r.id] }));
}

// ---------- Balance ----------
async function loadBalance() {
  try {
    const res = await fetch('/api/balance');
    const data = await res.json();
    const bal = data?.data?.sms_balance ?? data?.data?.balance ?? data?.balance;
    el('balance').textContent = bal !== undefined ? `Balance: ${bal} SMS units` : 'Balance: unavailable';
  } catch {
    el('balance').textContent = 'Balance: unavailable';
  }
}
loadBalance();

// Poll server every 20s for webhook-driven delivery updates once a campaign exists.
setInterval(async () => {
  if (!state.campaign) return;
  try {
    const res = await fetch(`/api/campaigns/${state.campaign.id}/messages`);
    const data = await res.json();
    mergeServerMessages(data.messages);
    renderTable();
  } catch (e) {
    // silent - next tick will retry
  }
}, 20000);
