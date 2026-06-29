'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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

export default function HomePage() {
  const [campaign, setCampaign] = useState(null);
  const [recipients, setRecipients] = useState([]);
  const [filterStatus, setFilterStatus] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [balance, setBalance] = useState('Balance: —');
  const [uploadError, setUploadError] = useState('');
  const [fileName, setFileName] = useState('');
  const [isDragover, setIsDragover] = useState(false);
  const [skipIssues, setSkipIssues] = useState(true);
  const [sendingAll, setSendingAll] = useState(false);
  const [sendAllLabel, setSendAllLabel] = useState('Send to all ready recipients');
  const [refreshing, setRefreshing] = useState(false);
  const [reports, setReports] = useState([]);
  const [reportStats, setReportStats] = useState(null);
  const [syncingReports, setSyncingReports] = useState(false);

  const fileInputRef = useRef(null);
  const recipientsRef = useRef(recipients);
  const campaignRef = useRef(campaign);

  useEffect(() => {
    recipientsRef.current = recipients;
  }, [recipients]);

  useEffect(() => {
    campaignRef.current = campaign;
  }, [campaign]);

  const mergeServerMessages = useCallback((serverMessages) => {
    const byId = Object.fromEntries(serverMessages.map((m) => [m.id, m]));
    setRecipients((prev) => prev.map((r) => ({ ...r, ...byId[r.id] })));
  }, []);

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
      setRecipients(data.recipients);
    } catch (err) {
      setUploadError(err.message);
    }
  }, []);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setIsDragover(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const ready = useMemo(
    () => recipients.filter((x) => x.sendStatus === 'pending' && !x.phoneIssue && x.message),
    [recipients]
  );
  const invalidPhone = useMemo(() => recipients.filter((x) => x.phoneIssue), [recipients]);
  const incomplete = useMemo(
    () => recipients.filter((x) => !x.phoneIssue && (!x.name || !x.license)),
    [recipients]
  );
  const sample = ready[0] || recipients[0];

  const sendable = useMemo(
    () => recipients.filter((r) => !r.phoneIssue && r.message),
    [recipients]
  );
  const sent = useMemo(
    () => sendable.filter((r) => r.sendStatus === 'sent_ok' || r.sendStatus === 'send_failed'),
    [sendable]
  );
  const progressPct = sendable.length ? Math.round((sent.length / sendable.length) * 100) : 0;
  const okCount = sendable.filter((r) => r.sendStatus === 'sent_ok').length;
  const failedCount = sendable.filter((r) => r.sendStatus === 'send_failed').length;

  const filtered = useMemo(() => recipients.filter((row) => {
    const status = rowSendStatus(row);
    if (filterStatus !== 'all' && status !== filterStatus) return false;
    if (searchTerm) {
      const hay = `${row.name} ${row.license} ${row.phoneRaw} ${row.location}`.toLowerCase();
      if (!hay.includes(searchTerm)) return false;
    }
    return true;
  }), [recipients, filterStatus, searchTerm]);

  const sendOne = useCallback(async (id) => {
    const row = recipientsRef.current.find((r) => r.id === id);
    if (!row || row.phoneIssue || !row.message) return;

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
          if (data.result?.data?.id) updated.arkeselId = data.result.data.id;
          return updated;
        })
      );
    } catch {
      setRecipients((prev) =>
        prev.map((r) => (r.id === id ? { ...r, sendStatus: 'send_failed' } : r))
      );
    }
  }, []);

  const handleSendAll = useCallback(async () => {
    if (sendingAll) return;
    const targets = recipientsRef.current.filter((r) => {
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

    setSendingAll(true);
    setSendAllLabel(`Sending… (0 / ${targets.length})`);

    let done = 0;
    for (const row of targets) {
      await sendOne(row.id);
      done += 1;
      setSendAllLabel(`Sending… (${done} / ${targets.length})`);
      await sleep(300);
    }

    setSendAllLabel('Send to all ready recipients');
    setSendingAll(false);
  }, [sendingAll, skipIssues, sendOne]);

  const handleRefresh = useCallback(async () => {
    const current = recipientsRef.current;
    const pendingDelivery = current.filter((r) => r.arkeselId && !r.deliveryStatus);
    const currentCampaign = campaignRef.current;

    if (!pendingDelivery.length) {
      if (currentCampaign) {
        const res = await fetch(`/api/campaigns/${currentCampaign.id}/messages`);
        const data = await res.json();
        mergeServerMessages(data.messages);
      }
      return;
    }

    setRefreshing(true);
    for (const row of pendingDelivery) {
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
        // ignore individual failures
      }
      await sleep(150);
    }
    setRefreshing(false);
  }, [mergeServerMessages]);

  const loadReports = useCallback(async () => {
    try {
      const res = await fetch('/api/reports');
      const data = await res.json();
      if (res.ok) {
        setReports(data.reports || []);
        setReportStats(data.stats || null);
      }
    } catch {
      // silent
    }
  }, []);

  const handleSyncReports = useCallback(async () => {
    setSyncingReports(true);
    try {
      const res = await fetch('/api/reports/sync', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Sync failed');
      await loadReports();
      if (campaign) {
        const msgRes = await fetch(`/api/campaigns/${campaign.id}/messages`);
        const msgData = await msgRes.json();
        mergeServerMessages(msgData.messages);
      }
    } catch (err) {
      alert(err.message);
    } finally {
      setSyncingReports(false);
    }
  }, [campaign, loadReports, mergeServerMessages]);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

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
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/campaigns/${campaign.id}/messages`);
        const data = await res.json();
        mergeServerMessages(data.messages);
      } catch {
        // silent - next tick will retry
      }
    }, 20000);
    return () => clearInterval(interval);
  }, [campaign, mergeServerMessages]);

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
          <h2 className="panel__title"><span className="step">1</span> Upload the licence list</h2>
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

        {campaign && (
          <section className="panel">
            <h2 className="panel__title"><span className="step">2</span> Review before sending</h2>

            <div className="summary-grid">
              <div className="summary-card summary-card--good">
                <div className="summary-card__num">{recipients.length}</div>
                <div className="summary-card__label">Total rows</div>
              </div>
              <div className="summary-card summary-card--good">
                <div className="summary-card__num">{ready.length}</div>
                <div className="summary-card__label">Ready to send</div>
              </div>
              <div className="summary-card summary-card--warn">
                <div className="summary-card__num">{invalidPhone.length}</div>
                <div className="summary-card__label">Missing / invalid phone</div>
              </div>
              <div className="summary-card summary-card--bad">
                <div className="summary-card__num">{incomplete.length}</div>
                <div className="summary-card__label">Incomplete rows</div>
              </div>
            </div>

            <div className="template-preview">
              <p className="template-preview__label">Sample message</p>
              <p className="template-preview__bubble">{sample?.message || 'No valid rows to preview.'}</p>
            </div>

            <div className="settings-row">
              <label className="field">
                <span className="field__label">Sender ID</span>
                <input type="text" defaultValue="PharmCncl" maxLength={11} readOnly title="Set SMS_SENDER_ID in .env.local" />
              </label>
              <label className="field field--checkbox">
                <input
                  type="checkbox"
                  checked={skipIssues}
                  onChange={(e) => setSkipIssues(e.target.checked)}
                />
                <span>Skip rows with missing/invalid phone or data</span>
              </label>
            </div>

            <div className="action-row">
              <button
                type="button"
                className="btn btn--primary"
                disabled={sendingAll}
                onClick={handleSendAll}
              >
                {sendAllLabel}
              </button>
              <span className="action-row__note">
                {ready.length} of {recipients.length} recipients will be messaged
              </span>
            </div>
          </section>
        )}

        {campaign && (
          <section className="panel panel--wide">
            <div className="panel__header-row">
              <h2 className="panel__title"><span className="step">3</span> Send &amp; delivery status</h2>
              <div className="filter-row">
                <input
                  type="search"
                  placeholder="Search name, licence, phone…"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value.trim().toLowerCase())}
                />
                <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                  <option value="all">All statuses</option>
                  <option value="pending">Pending</option>
                  <option value="sent_ok">Sent</option>
                  <option value="send_failed">Send failed</option>
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
              {sendable.length
                ? `${sent.length} / ${sendable.length} attempted — ${okCount} sent, ${failedCount} failed`
                : 'No sendable recipients found.'}
            </p>

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
                  {filtered.map((row) => {
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
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}
        <section className="panel panel--wide">
          <div className="panel__header-row">
            <h2 className="panel__title">Arkesel SMS Reports</h2>
            <div className="filter-row">
              <button
                type="button"
                className="btn btn--primary"
                disabled={syncingReports}
                onClick={handleSyncReports}
              >
                {syncingReports ? 'Syncing…' : 'Sync reports to database'}
              </button>
            </div>
          </div>

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

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Sent</th>
                  <th>Type</th>
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
                    <td>{row.sourceType}</td>
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
                    <td colSpan={7} className="empty-row">
                      No reports in the database yet. Click &quot;Sync reports to database&quot; to pull delivery data from Arkesel.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      <footer className="footnote">
        <p>
          Delivery reports arrive automatically via Arkesel&apos;s webhook once it&apos;s configured on your dashboard.
          If you haven&apos;t set that up yet, use &quot;Refresh statuses&quot; to poll manually.
        </p>
      </footer>
    </>
  );
}
