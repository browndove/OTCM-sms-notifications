'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const MESSAGE_PAGE_SIZE = 50;
const REPORT_PAGE_SIZE = 25;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatReportTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}

function formatBatchDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}

function rowSendStatus(row) {
  if (row.phoneIssue) return 'invalid_phone';
  if (!row.name || !row.license) return 'incomplete_row';
  return row.sendStatus;
}

const STATUS_LABELS = {
  pending: 'Pending',
  queued: 'Sending…',
  sent_ok: 'Sent',
  send_failed: 'Send failed',
  invalid_phone: 'Invalid phone',
  incomplete_row: 'Incomplete'
};

function StatusBadge({ status }) {
  return (
    <span className={`badge badge--${status}`}>
      {STATUS_LABELS[status] || status}
    </span>
  );
}

function DeliveryBadge({ row }) {
  if (!row.deliveryStatus) {
    return <span className="badge badge--unknown">No report yet</span>;
  }
  const s = row.deliveryStatus.toLowerCase();
  let cls = 'unknown';
  if (['delivered', 'success', 'sent'].includes(s)) cls = 'delivered';
  else if (['failed', 'undelivered', 'rejected', 'expired'].includes(s)) cls = 'failed';
  return <span className={`badge badge--${cls}`}>{row.deliveryStatus}</span>;
}

function Pagination({ page, pageSize, total, onPageChange }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;

  return (
    <div className="pagination">
      <button
        type="button"
        className="btn btn--ghost btn--small"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        Previous
      </button>
      <span className="pagination__label">
        Page {page} of {totalPages} · {total} rows
      </span>
      <button
        type="button"
        className="btn btn--ghost btn--small"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
      >
        Next
      </button>
    </div>
  );
}

export default function HomePage() {
  const [batches, setBatches] = useState([]);
  const [campaign, setCampaign] = useState(null);
  const [stats, setStats] = useState(null);
  const [recipients, setRecipients] = useState([]);
  const [messagePage, setMessagePage] = useState(1);
  const [messageTotal, setMessageTotal] = useState(0);
  const [filterStatus, setFilterStatus] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [balance, setBalance] = useState('Balance: —');
  const [uploadError, setUploadError] = useState('');
  const [fileName, setFileName] = useState('');
  const [isDragover, setIsDragover] = useState(false);
  const [skipIssues, setSkipIssues] = useState(true);
  const [sendingAll, setSendingAll] = useState(false);
  const [resendingSubmitted, setResendingSubmitted] = useState(false);
  const [sendAllLabel, setSendAllLabel] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [reports, setReports] = useState([]);
  const [reportStats, setReportStats] = useState(null);
  const [reportPage, setReportPage] = useState(1);
  const [reportTotal, setReportTotal] = useState(0);
  const [showReports, setShowReports] = useState(false);
  const [syncingReports, setSyncingReports] = useState(false);
  const [sampleMessage, setSampleMessage] = useState('');

  const fileInputRef = useRef(null);
  const campaignRef = useRef(campaign);
  const filterRef = useRef({ filterStatus, searchTerm, messagePage });

  useEffect(() => {
    campaignRef.current = campaign;
  }, [campaign]);

  useEffect(() => {
    filterRef.current = { filterStatus, searchTerm, messagePage };
  }, [filterStatus, searchTerm, messagePage]);

  const loadBatches = useCallback(async () => {
    try {
      const res = await fetch('/api/campaigns');
      const data = await res.json();
      if (res.ok) setBatches(data.campaigns || []);
    } catch {
      // silent
    }
  }, []);

  const loadMessages = useCallback(async (campaignId, page = 1, status = 'all', search = '') => {
    const offset = (page - 1) * MESSAGE_PAGE_SIZE;
    const params = new URLSearchParams({
      limit: String(MESSAGE_PAGE_SIZE),
      offset: String(offset),
      status,
      search
    });
    const res = await fetch(`/api/campaigns/${campaignId}/messages?${params}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load messages');

    setRecipients(data.messages || []);
    setStats(data.stats || null);
    setMessageTotal(data.total ?? 0);
    setMessagePage(page);
    return data;
  }, []);

  const loadSampleMessage = useCallback(async (campaignId) => {
    try {
      const params = new URLSearchParams({ limit: '1', offset: '0', status: 'pending' });
      const res = await fetch(`/api/campaigns/${campaignId}/messages?${params}`);
      const data = await res.json();
      const msg = data.messages?.[0]?.message;
      setSampleMessage(msg || 'No pending messages in this batch.');
    } catch {
      setSampleMessage('—');
    }
  }, []);

  const loadReports = useCallback(async (page = 1, campaignId = null) => {
    const offset = (page - 1) * REPORT_PAGE_SIZE;
    const params = new URLSearchParams({
      limit: String(REPORT_PAGE_SIZE),
      offset: String(offset)
    });
    if (campaignId) params.set('campaignId', campaignId);

    const res = await fetch(`/api/reports?${params}`);
    const data = await res.json();
    if (res.ok) {
      setReports(data.reports || []);
      setReportStats(data.stats || null);
      setReportTotal(data.total ?? 0);
      setReportPage(page);
    }
  }, []);

  const openBatch = useCallback(async (batch) => {
    setCampaign(batch);
    setFileName(batch.sourceFile || '');
    setFilterStatus('all');
    setSearchTerm('');
    setSearchInput('');
    setMessagePage(1);
    setReportPage(1);
    await loadMessages(batch.id, 1, 'all', '');
    await loadSampleMessage(batch.id);
    if (showReports) {
      await loadReports(1, batch.id);
    }
  }, [loadMessages, loadSampleMessage, showReports, loadReports]);

  const refreshCurrentView = useCallback(async () => {
    const current = campaignRef.current;
    if (!current) return;
    const { filterStatus: status, searchTerm: search, messagePage: page } = filterRef.current;
    await loadMessages(current.id, page, status, search);
    await loadBatches();
    await loadSampleMessage(current.id);
  }, [loadMessages, loadBatches, loadSampleMessage]);

  const handleFile = useCallback(async (file) => {
    setFileName(file.name);
    setUploadError('');

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');

      setCampaign(data.campaign);
      setStats(data.stats || null);
      setFilterStatus('all');
      setSearchTerm('');
      setSearchInput('');
      setMessagePage(1);
      await loadMessages(data.campaign.id, 1, 'all', '');
      await loadSampleMessage(data.campaign.id);
      await loadBatches();
    } catch (err) {
      setUploadError(err.message);
    }
  }, [loadMessages, loadSampleMessage, loadBatches]);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setIsDragover(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const onFilterChange = useCallback(async (status) => {
    setFilterStatus(status);
    if (!campaign) return;
    await loadMessages(campaign.id, 1, status, searchTerm);
  }, [campaign, loadMessages, searchTerm]);

  const onSearchChange = useCallback((value) => {
    setSearchInput(value);
  }, []);

  useEffect(() => {
    if (!campaign) return undefined;
    const timer = setTimeout(async () => {
      setSearchTerm(searchInput);
      await loadMessages(campaign.id, 1, filterStatus, searchInput);
    }, 400);
    return () => clearTimeout(timer);
  }, [searchInput, campaign, filterStatus, loadMessages]);

  const onMessagePageChange = useCallback(async (page) => {
    if (!campaign) return;
    await loadMessages(campaign.id, page, filterStatus, searchTerm);
  }, [campaign, loadMessages, filterStatus, searchTerm]);

  const sendOne = useCallback(async (id) => {
    setRecipients((prev) =>
      prev.map((r) => (r.id === id ? { ...r, sendStatus: 'queued' } : r))
    );

    try {
      const res = await fetch(`/api/send/${id}`, { method: 'POST' });
      const data = await res.json();
      setRecipients((prev) =>
        prev.map((r) => {
          if (r.id !== id) return r;
          const updated = { ...r, sendStatus: data.ok ? 'sent_ok' : 'send_failed' };
          const arkeselId = data.result?.data?.id || data.result?.data?.[0]?.id;
          if (arkeselId) updated.arkeselId = arkeselId;
          return updated;
        })
      );
      await refreshCurrentView();
    } catch {
      setRecipients((prev) =>
        prev.map((r) => (r.id === id ? { ...r, sendStatus: 'send_failed' } : r))
      );
    }
  }, [refreshCurrentView]);

  const handleSendAll = useCallback(async () => {
    if (sendingAll) return;
    const currentCampaign = campaignRef.current;
    if (!currentCampaign || !stats) return;

    const remaining = stats.remaining || 0;
    if (!remaining) {
      alert('No sendable recipients left in this batch.');
      return;
    }
    if (!confirm(`Send SMS to ${remaining} remaining recipients in this batch? This will use Arkesel credits.`)) {
      return;
    }

    setSendingAll(true);
    setSendAllLabel(`Sending… (0 done, ${remaining} left)`);

    try {
      let left = remaining;
      let done = 0;

      while (left > 0) {
        const res = await fetch(`/api/campaigns/${currentCampaign.id}/send-pending`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ limit: 25 })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Send failed');

        done += data.processed;
        left = data.remaining;
        setSendAllLabel(`Sending… (${done} done, ${left} left)`);
        await refreshCurrentView();

        if (data.processed === 0) break;
      }
    } catch (err) {
      alert(err.message || 'Sending stopped. Click again to resume this batch.');
      await refreshCurrentView();
    } finally {
      setSendingAll(false);
      setSendAllLabel('');
    }
  }, [sendingAll, stats, refreshCurrentView]);

  const handleResendSubmitted = useCallback(async () => {
    if (resendingSubmitted || sendingAll) return;
    const currentCampaign = campaignRef.current;
    if (!currentCampaign || !stats) return;

    const submittedCount = stats.submitted || 0;
    if (!submittedCount) {
      alert('No SUBMITTED deliveries in this batch. Sync reports first if you expect some.');
      return;
    }
    if (!confirm(
      `Resend SMS to ${submittedCount} people with SUBMITTED delivery status in this batch only? This uses extra Arkesel credits.`
    )) {
      return;
    }

    setResendingSubmitted(true);
    setSendAllLabel(`Resending SUBMITTED… (0 done, ${submittedCount} left)`);

    try {
      let left = submittedCount;
      let done = 0;

      while (left > 0) {
        const res = await fetch(`/api/campaigns/${currentCampaign.id}/resend-submitted`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ limit: 25 })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Resend failed');

        done += data.processed;
        left = data.remaining;
        setSendAllLabel(`Resending SUBMITTED… (${done} done, ${left} left)`);
        await refreshCurrentView();

        if (data.processed === 0) break;
      }
    } catch (err) {
      alert(err.message || 'Resend stopped. Click again to continue.');
      await refreshCurrentView();
    } finally {
      setResendingSubmitted(false);
      setSendAllLabel('');
    }
  }, [resendingSubmitted, sendingAll, stats, refreshCurrentView]);

  const handleRefresh = useCallback(async () => {
    const current = recipients.filter((r) => r.arkeselId && !r.deliveryStatus);
    if (!current.length) {
      await refreshCurrentView();
      return;
    }

    setRefreshing(true);
    for (const row of current) {
      try {
        const res = await fetch(`/api/status/${row.id}`);
        const data = await res.json();
        const status = data?.data?.status || data?.status;
        if (status) {
          setRecipients((prev) =>
            prev.map((r) => (r.id === row.id ? { ...r, deliveryStatus: status } : r))
          );
        }
      } catch {
        // ignore
      }
      await sleep(150);
    }
    setRefreshing(false);
    await refreshCurrentView();
  }, [recipients, refreshCurrentView]);

  const handleSyncReports = useCallback(async () => {
    const currentCampaign = campaignRef.current;
    if (!currentCampaign) {
      alert('Open a batch first — sync only pulls delivery reports for that batch.');
      return;
    }

    setSyncingReports(true);
    try {
      const res = await fetch('/api/reports/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId: currentCampaign.id })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Sync failed');
      if (showReports) {
        await loadReports(reportPage, currentCampaign.id);
      }
      await refreshCurrentView();
    } catch (err) {
      alert(err.message);
    } finally {
      setSyncingReports(false);
    }
  }, [showReports, reportPage, loadReports, refreshCurrentView]);

  useEffect(() => {
    loadBatches();
  }, [loadBatches]);

  useEffect(() => {
    async function loadBalance() {
      try {
        const res = await fetch('/api/balance');
        const data = await res.json();
        const bal = data?.data?.sms_balance ?? data?.data?.balance ?? data?.balance;
        setBalance(bal !== undefined ? `Balance: ${bal} SMS units` : 'Balance: unavailable');
      } catch {
        setBalance('Balance: unavailable');
      }
    }
    loadBalance();
  }, []);

  useEffect(() => {
    if (!campaign) return undefined;
    const interval = setInterval(() => {
      refreshCurrentView();
    }, 20000);
    return () => clearInterval(interval);
  }, [campaign, refreshCurrentView]);

  const remaining = stats?.remaining ?? 0;
  const sendable = stats?.sendable ?? 0;
  const okCount = stats?.sent_ok ?? 0;
  const failedCount = stats?.send_failed ?? 0;
  const pendingCount = stats?.pending ?? 0;
  const submittedCount = stats?.submitted ?? 0;
  const attempted = okCount + failedCount;
  const progressPct = sendable ? Math.round((attempted / sendable) * 100) : 0;

  return (
    <>
      <header className="topbar">
        <div className="topbar__brand">
          <span className="topbar__mark">OTCMS</span>
          <span className="topbar__title">Training Programme · Bulk SMS Sender</span>
        </div>
        <div className="topbar__balance">{balance}</div>
      </header>

      <main className="layout">
        <section className="panel">
          <h2 className="panel__title">Batches</h2>
          <p className="panel__hint">Each upload is a separate batch. Open one to send and track — data loads page by page.</p>

          {batches.length ? (
            <div className="batch-list">
              {batches.map((batch) => (
                <button
                  key={batch.id}
                  type="button"
                  className={`batch-card${campaign?.id === batch.id ? ' batch-card--active' : ''}`}
                  onClick={() => openBatch(batch)}
                >
                  <div className="batch-card__title">{batch.sourceFile}</div>
                  <div className="batch-card__meta">{formatBatchDate(batch.createdAt)}</div>
                  <div className="batch-card__stats">
                    {batch.messageCount ?? batch.totalRows} rows · {batch.sentOk ?? 0} sent
                    {(batch.remaining ?? 0) > 0 ? ` · ${batch.remaining} left` : ''}
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <p className="panel__hint">No batches yet. Upload a spreadsheet below to create one.</p>
          )}
        </section>

        <section className="panel">
          <h2 className="panel__title"><span className="step">+</span> Add new batch</h2>
          <p className="panel__hint">Excel file with columns: SN, NAMES, LOCATION, CONTACT, LICENSE NUMBERS.</p>
          <div
            className={`dropzone${isDragover ? ' is-dragover' : ''}`}
            onDragEnter={(e) => { e.preventDefault(); setIsDragover(true); }}
            onDragOver={(e) => { e.preventDefault(); setIsDragover(true); }}
            onDragLeave={(e) => { e.preventDefault(); setIsDragover(false); }}
            onDrop={onDrop}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              hidden
              onChange={(e) => {
                if (e.target.files?.[0]) handleFile(e.target.files[0]);
              }}
            />
            <p className="dropzone__text">
              Drag your file here, or{' '}
              <button type="button" className="link-btn" onClick={() => fileInputRef.current?.click()}>
                browse
              </button>
            </p>
            {fileName && <p className="dropzone__filename">{fileName}</p>}
          </div>
          {uploadError && <div className="error">{uploadError}</div>}
        </section>

        {campaign && stats && (
          <section className="panel">
            <h2 className="panel__title"><span className="step">2</span> Review batch: {campaign.sourceFile}</h2>

            <p className="panel__hint">Sending only affects this batch — not other uploads.</p>

            <div className="summary-grid">
              <div className="summary-card summary-card--good">
                <div className="summary-card__num">{stats.total}</div>
                <div className="summary-card__label">Total rows</div>
              </div>
              <div className="summary-card summary-card--good">
                <div className="summary-card__num">{stats.ready}</div>
                <div className="summary-card__label">Ready to send</div>
              </div>
              <div className="summary-card summary-card--warn">
                <div className="summary-card__num">{stats.invalid_phone}</div>
                <div className="summary-card__label">Missing / invalid phone</div>
              </div>
              <div className="summary-card summary-card--bad">
                <div className="summary-card__num">{stats.incomplete}</div>
                <div className="summary-card__label">Incomplete rows</div>
              </div>
            </div>

            <div className="template-preview">
              <p className="template-preview__label">Sample message</p>
              <p className="template-preview__bubble">{sampleMessage || '—'}</p>
            </div>

            <div className="settings-row">
              <label className="field field--checkbox">
                <input
                  type="checkbox"
                  checked={skipIssues}
                  onChange={(e) => setSkipIssues(e.target.checked)}
                />
                <span>Skip rows with missing/invalid phone or data</span>
              </label>
            </div>

            <div className="action-row action-row--wrap">
              <button
                type="button"
                className="btn btn--primary"
                disabled={sendingAll || resendingSubmitted || remaining === 0}
                onClick={handleSendAll}
              >
                {sendingAll
                  ? sendAllLabel || 'Sending…'
                  : remaining > 0
                    ? `Send remaining in this batch (${remaining})`
                    : 'Batch fully attempted'}
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                disabled={sendingAll || resendingSubmitted || submittedCount === 0}
                onClick={handleResendSubmitted}
                title="Resend to people whose delivery status is still SUBMITTED (not confirmed delivered)"
              >
                {resendingSubmitted
                  ? sendAllLabel || 'Resending…'
                  : submittedCount > 0
                    ? `Resend SUBMITTED (${submittedCount})`
                    : 'No SUBMITTED to resend'}
              </button>
              <span className="action-row__note">
                {okCount} sent · {pendingCount} waiting · {failedCount} failed · {submittedCount} submitted
              </span>
            </div>
          </section>
        )}

        {campaign && stats && (
          <section className="panel panel--wide">
            <div className="panel__header-row">
              <h2 className="panel__title"><span className="step">3</span> Recipients (this batch)</h2>
              <div className="filter-row">
                <input
                  type="search"
                  placeholder="Search name, licence, phone…"
                  value={searchInput}
                  onChange={(e) => onSearchChange(e.target.value.trim().toLowerCase())}
                />
                <select value={filterStatus} onChange={(e) => onFilterChange(e.target.value)}>
                  <option value="all">All statuses</option>
                  <option value="pending">Pending</option>
                  <option value="sent_ok">Sent</option>
                  <option value="send_failed">Send failed</option>
                  <option value="submitted">Delivery: SUBMITTED</option>
                  <option value="invalid_phone">Invalid phone</option>
                  <option value="incomplete_row">Incomplete row</option>
                </select>
                <button
                  type="button"
                  className="btn btn--ghost"
                  disabled={refreshing}
                  onClick={handleRefresh}
                >
                  {refreshing ? 'Checking…' : 'Refresh statuses'}
                </button>
              </div>
            </div>

            <div className="progress-bar">
              <div className="progress-bar__fill" style={{ width: `${progressPct}%` }} />
            </div>
            <p className="progress-text">
              {sendable
                ? `${okCount} sent · ${pendingCount} waiting · ${failedCount} failed — ${attempted} / ${sendable} attempted in batch`
                : 'No sendable recipients in this batch.'}
            </p>

            <Pagination
              page={messagePage}
              pageSize={MESSAGE_PAGE_SIZE}
              total={messageTotal}
              onPageChange={onMessagePageChange}
            />

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>SN</th>
                    <th>Name</th>
                    <th>Location</th>
                    <th>Licence No.</th>
                    <th>Phone</th>
                    <th>Send status</th>
                    <th>Delivery</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {recipients.length ? recipients.map((row) => {
                    const phoneDisplay = row.phoneFormatted || row.phoneRaw || '—';
                    const status = rowSendStatus(row);
                    const canRetry = row.sendStatus === 'send_failed' || row.sendStatus === 'pending';
                    const retryDisabled = row.phoneIssue || !row.message;
                    return (
                      <tr key={row.id}>
                        <td>{row.sn ?? ''}</td>
                        <td>{row.name}</td>
                        <td>{row.location}</td>
                        <td className="license">{row.license}</td>
                        <td className="phone">{phoneDisplay}</td>
                        <td><StatusBadge status={status} /></td>
                        <td><DeliveryBadge row={row} /></td>
                        <td>
                          {canRetry && (
                            <button
                              type="button"
                              className="btn btn--ghost btn--small"
                              disabled={retryDisabled}
                              onClick={() => sendOne(row.id)}
                            >
                              Send
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  }) : (
                    <tr>
                      <td colSpan={8} className="empty-row">No rows match this filter.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <Pagination
              page={messagePage}
              pageSize={MESSAGE_PAGE_SIZE}
              total={messageTotal}
              onPageChange={onMessagePageChange}
            />
          </section>
        )}

        <section className="panel panel--wide">
          <div className="panel__header-row">
            <h2 className="panel__title">Delivery reports</h2>
            <div className="filter-row">
              {campaign ? (
                <>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={() => {
                      const next = !showReports;
                      setShowReports(next);
                      if (next) loadReports(1, campaign.id);
                    }}
                  >
                    {showReports ? 'Hide reports' : 'View reports'}
                  </button>
                  <button
                    type="button"
                    className="btn btn--primary"
                    disabled={syncingReports}
                    onClick={handleSyncReports}
                  >
                    {syncingReports ? 'Syncing…' : 'Sync this batch from Arkesel'}
                  </button>
                </>
              ) : (
                <span className="panel__hint">Open a batch to view and sync its delivery reports.</span>
              )}
            </div>
          </div>

          {campaign && showReports && (
            <>
              <p className="panel__hint">
                Scoped to <strong>{campaign.sourceFile}</strong> — only messages sent in this batch are synced and shown.
              </p>

              {reportStats && (
                <div className="summary-grid summary-grid--reports">
                  <div className="summary-card summary-card--good">
                    <div className="summary-card__num">{reportStats.total}</div>
                    <div className="summary-card__label">Stored reports</div>
                  </div>
                  <div className="summary-card summary-card--good">
                    <div className="summary-card__num">{reportStats.delivered}</div>
                    <div className="summary-card__label">Delivered</div>
                  </div>
                  <div className="summary-card summary-card--warn">
                    <div className="summary-card__num">{reportStats.units_used}</div>
                    <div className="summary-card__label">SMS units used</div>
                  </div>
                </div>
              )}

              <Pagination
                page={reportPage}
                pageSize={REPORT_PAGE_SIZE}
                total={reportTotal}
                onPageChange={(page) => loadReports(page, campaign.id)}
              />

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Sent</th>
                      <th>Sender</th>
                      <th>Recipient</th>
                      <th>Units</th>
                      <th>Status</th>
                      <th>Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reports.length ? reports.map((row) => (
                      <tr key={row.arkeselId}>
                        <td className="phone">{formatReportTime(row.sentAt)}</td>
                        <td>{row.senderId}</td>
                        <td className="phone">{row.recipient}</td>
                        <td>{row.units}</td>
                        <td>
                          <span className={`badge badge--${row.status === 'DELIVERED' ? 'delivered' : row.status === 'SUBMITTED' ? 'queued' : 'unknown'}`}>
                            {row.status}
                          </span>
                        </td>
                        <td className="message-preview">{row.messageBody}</td>
                      </tr>
                    )) : (
                      <tr>
                        <td colSpan={6} className="empty-row">
                          No reports yet for this batch. Send messages, then click &quot;Sync this batch from Arkesel&quot;.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      </main>

      <footer className="footnote">
        <p>
          Uploads create separate batches. Open a batch to work on it — only 50 recipients load per page.
        </p>
      </footer>
    </>
  );
}
