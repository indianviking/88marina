/* 88 Marina — Cleaner View JavaScript */

// ── Config ──
const SUPABASE_URL = 'https://aagirxlfyjaunqlatiuf.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_jmT7z_nravZZ4UePIExrvw_W1z4y3rL';
const API_BASE = '/.netlify/functions/cleaner-api';

// ── Supabase Client ──
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── State ──
let checklistItems = [];
let invoiceCleans = [];
let selectedCleanIds = new Set();
let invoiceFile = null;

// ── Init ──
document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  loadUpcoming();
  loadInvoiceBadge();
});

// ── Tabs ──
function initTabs() {
  const tabs = document.querySelectorAll('.tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');

      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      const panel = document.getElementById('panel-' + tab.dataset.tab);
      panel.classList.add('active');

      // Load data on first tab switch
      if (tab.dataset.tab === 'history' && !panel.dataset.loaded) {
        panel.dataset.loaded = 'true';
        loadHistory();
      }
      if (tab.dataset.tab === 'invoice' && !panel.dataset.loaded) {
        panel.dataset.loaded = 'true';
        loadInvoice();
      }
    });
  });
}

// ── Date Formatting ──
function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function formatMonthYear(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  return `${months[d.getMonth()]} ${d.getFullYear()}`;
}

function getMonthKey(dateStr) {
  return dateStr.substring(0, 7); // "YYYY-MM"
}

function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

function formatRate(rateType) {
  const labels = { standard: 'Standard', weekend: 'Weekend', bank_holiday: 'Bank Holiday' };
  return labels[rateType] || rateType;
}

// ── Error Handling ──
function showError(message) {
  const existing = document.querySelector('.error-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'error-toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

// ── API Helper ──
async function apiCall(action, data = {}) {
  try {
    const res = await fetch(API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...data })
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'API request failed');
    return result;
  } catch (err) {
    showError(err.message);
    throw err;
  }
}

// ══════════════════════════════════════
// ── UPCOMING TAB ──
// ══════════════════════════════════════

async function loadUpcoming() {
  const loading = document.getElementById('upcoming-loading');
  const list = document.getElementById('upcoming-list');
  const empty = document.getElementById('upcoming-empty');

  try {
    const today = todayStr();

    // Fetch pending cleanings with date >= today
    const { data: pendingCleans, error: err1 } = await supabase
      .from('cleanings')
      .select('*, bookings!inner(checkin, checkout, nights, guest_name)')
      .eq('status', 'pending')
      .gte('cleaning_date', today)
      .order('cleaning_date', { ascending: true });

    if (err1) throw err1;

    // Fetch cancelled cleanings not yet acknowledged
    const { data: cancelledCleans, error: err2 } = await supabase
      .from('cleanings')
      .select('*, bookings!inner(checkin, checkout, nights, guest_name)')
      .eq('status', 'cancelled')
      .eq('cancellation_acknowledged', false)
      .order('cleaning_date', { ascending: true });

    if (err2) throw err2;

    // Merge and sort
    const allCleans = [...(pendingCleans || []), ...(cancelledCleans || [])];
    allCleans.sort((a, b) => a.cleaning_date.localeCompare(b.cleaning_date));

    // Mark new items as seen
    const newIds = allCleans.filter(c => c.is_new).map(c => c.id);
    if (newIds.length > 0) {
      markNewAsSeen(newIds);
    }

    // Load checklist items for checklist panels
    const { data: items } = await supabase
      .from('checklist_items')
      .select('*')
      .eq('active', true)
      .order('sort_order', { ascending: true });

    checklistItems = items || [];

    loading.style.display = 'none';

    if (allCleans.length === 0) {
      empty.style.display = 'block';
      return;
    }

    // Group by month
    const grouped = {};
    allCleans.forEach(c => {
      const key = getMonthKey(c.cleaning_date);
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(c);
    });

    list.innerHTML = '';
    for (const [monthKey, cleans] of Object.entries(grouped)) {
      const header = document.createElement('div');
      header.className = 'month-header';
      header.textContent = formatMonthYear(cleans[0].cleaning_date);
      list.appendChild(header);

      cleans.forEach(clean => {
        list.appendChild(createCleanCard(clean));
      });
    }
  } catch (err) {
    loading.style.display = 'none';
    showError('Failed to load upcoming cleans');
    console.error(err);
  }
}

function createCleanCard(clean) {
  const card = document.createElement('div');
  card.className = 'clean-card' + (clean.status === 'cancelled' ? ' cancelled' : '');
  card.dataset.id = clean.id;

  const booking = clean.bookings;
  const isCancelled = clean.status === 'cancelled';

  // Top row: date + badges
  let badgesHtml = '';
  if (clean.is_new && !isCancelled) {
    badgesHtml += '<span class="badge badge-new">New</span>';
  }
  if (isCancelled) {
    badgesHtml += '<span class="badge badge-cancelled">Cancelled</span>';
  }
  if (clean.rate_type !== 'standard') {
    badgesHtml += `<span class="badge badge-rate">${formatRate(clean.rate_type)}</span>`;
  }

  // Details
  const checkinFormatted = formatDate(booking.checkin);
  const checkoutFormatted = formatDate(booking.checkout);

  // Actions
  let actionsHtml = '';
  if (isCancelled) {
    actionsHtml = `
      <button class="btn btn-acknowledge" onclick="acknowledgeCancellation('${clean.id}')">
        Acknowledge
      </button>`;
  } else {
    const plannerText = clean.added_to_planner ? 'Added to planner &#10003;' : 'Added to planner?';
    const plannerClass = clean.added_to_planner ? 'btn btn-planner added' : 'btn btn-planner';
    const plannerDisabled = clean.added_to_planner ? 'disabled' : '';

    actionsHtml = `
      <button class="${plannerClass}" ${plannerDisabled} onclick="togglePlanner('${clean.id}', this)">
        ${plannerText}
      </button>
      <button class="btn btn-complete" onclick="markComplete('${clean.id}', this)">
        Mark complete
      </button>
      <button class="btn btn-checklist" onclick="toggleChecklist('${clean.id}', this)">
        Checklist
      </button>`;
  }

  card.innerHTML = `
    <div class="card-top">
      <div class="card-date">${formatDate(clean.cleaning_date)}</div>
      <div class="card-badges">${badgesHtml}</div>
    </div>
    <div class="card-details">
      <span>${checkinFormatted}</span> &rarr; <span>${checkoutFormatted}</span>
      &nbsp;&middot;&nbsp; ${booking.nights} night${booking.nights !== 1 ? 's' : ''}
    </div>
    <div class="card-rate">&pound;${clean.rate_amount} &middot; ${formatRate(clean.rate_type)} rate</div>
    <div class="card-actions">${actionsHtml}</div>
    <div class="checklist-panel" id="checklist-${clean.id}">
      ${renderChecklistPanel(clean)}
    </div>`;

  return card;
}

function renderChecklistPanel(clean) {
  const data = clean.checklist_data || {};

  let itemsHtml = checklistItems.map(item => {
    const checked = data[item.id] ? 'checked' : '';
    const checkedClass = data[item.id] ? ' checked' : '';
    return `
      <div class="checklist-item${checkedClass}">
        <input type="checkbox" id="chk-${clean.id}-${item.id}" ${checked}
          onchange="saveChecklistItem('${clean.id}', '${item.id}', this.checked, this)">
        <label for="chk-${clean.id}-${item.id}">${escapeHtml(item.label)}</label>
      </div>`;
  }).join('');

  return `
    ${itemsHtml}
    <div class="checklist-notes">
      <label>Damage / Notes</label>
      <textarea placeholder="Any damage or notes..."
        onchange="saveDamageNotes('${clean.id}', this.value)"
        onblur="saveDamageNotes('${clean.id}', this.value)">${escapeHtml(clean.damage_notes || '')}</textarea>
      <div class="checklist-saved" id="saved-${clean.id}">Saved</div>
    </div>`;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// ── Upcoming Actions ──

async function markNewAsSeen(ids) {
  try {
    await apiCall('mark_seen', { cleaning_ids: ids });
  } catch (err) {
    console.error('Failed to mark as seen:', err);
  }
}

async function togglePlanner(cleaningId, btn) {
  btn.disabled = true;
  try {
    await apiCall('toggle_planner', { cleaning_id: cleaningId });
    btn.innerHTML = 'Added to planner &#10003;';
    btn.classList.add('added');
  } catch (err) {
    btn.disabled = false;
  }
}

async function markComplete(cleaningId, btn) {
  btn.disabled = true;
  btn.textContent = 'Completing...';
  try {
    await apiCall('mark_complete', { cleaning_id: cleaningId });
    const card = document.querySelector(`.clean-card[data-id="${cleaningId}"]`);
    if (card) {
      card.classList.add('fade-out');
      setTimeout(() => {
        card.remove();
        checkEmptyUpcoming();
        loadInvoiceBadge();
      }, 400);
    }
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Mark complete';
  }
}

async function acknowledgeCancellation(cleaningId) {
  const btn = event.target;
  btn.disabled = true;
  btn.textContent = 'Acknowledging...';
  try {
    await apiCall('acknowledge_cancellation', { cleaning_id: cleaningId });
    const card = document.querySelector(`.clean-card[data-id="${cleaningId}"]`);
    if (card) {
      card.classList.add('fade-out');
      setTimeout(() => {
        card.remove();
        checkEmptyUpcoming();
      }, 400);
    }
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Acknowledge';
  }
}

function checkEmptyUpcoming() {
  const list = document.getElementById('upcoming-list');
  const cards = list.querySelectorAll('.clean-card');
  if (cards.length === 0) {
    document.getElementById('upcoming-empty').style.display = 'block';
  }
  // Remove empty month headers
  const headers = list.querySelectorAll('.month-header');
  headers.forEach(header => {
    let next = header.nextElementSibling;
    if (!next || next.classList.contains('month-header')) {
      header.remove();
    }
  });
}

function toggleChecklist(cleaningId, btn) {
  const panel = document.getElementById('checklist-' + cleaningId);
  panel.classList.toggle('open');
  btn.textContent = panel.classList.contains('open') ? 'Close checklist' : 'Checklist';
}

async function saveChecklistItem(cleaningId, itemId, checked, checkbox) {
  const panel = document.getElementById('checklist-' + cleaningId);
  const itemDiv = checkbox.closest('.checklist-item');

  if (checked) {
    itemDiv.classList.add('checked');
  } else {
    itemDiv.classList.remove('checked');
  }

  // Gather all checkbox states in this panel
  const checkboxes = panel.querySelectorAll('input[type="checkbox"]');
  const data = {};
  checkboxes.forEach(cb => {
    const parts = cb.id.split('-');
    const iid = parts.slice(2).join('-'); // handle UUIDs with dashes
    data[iid] = cb.checked;
  });

  try {
    await apiCall('save_checklist', { cleaning_id: cleaningId, checklist_data: data });
    flashSaved(cleaningId);
  } catch (err) {
    console.error('Failed to save checklist:', err);
  }
}

async function saveDamageNotes(cleaningId, notes) {
  try {
    await apiCall('save_damage_notes', { cleaning_id: cleaningId, damage_notes: notes });
    flashSaved(cleaningId);
  } catch (err) {
    console.error('Failed to save notes:', err);
  }
}

function flashSaved(cleaningId) {
  const el = document.getElementById('saved-' + cleaningId);
  if (el) {
    el.classList.add('visible');
    setTimeout(() => el.classList.remove('visible'), 2000);
  }
}

// ══════════════════════════════════════
// ── HISTORY TAB ──
// ══════════════════════════════════════

async function loadHistory() {
  const loading = document.getElementById('history-loading');
  const list = document.getElementById('history-list');
  const empty = document.getElementById('history-empty');

  try {
    const today = todayStr();

    // Fetch cleanings for history:
    // cleaning_date < today OR status='complete' OR (status='cancelled' AND acknowledged)
    const { data: allCleans, error } = await supabase
      .from('cleanings')
      .select('*, bookings!inner(checkin, checkout, nights, guest_name), invoices(invoice_number, status)')
      .order('cleaning_date', { ascending: false });

    if (error) throw error;

    // Filter for history items
    const historyCleans = (allCleans || []).filter(c => {
      if (c.status === 'complete') return true;
      if (c.status === 'cancelled' && c.cancellation_acknowledged) return true;
      if (c.cleaning_date < today && c.status !== 'pending') return true;
      if (c.cleaning_date < today) return true;
      return false;
    });

    loading.style.display = 'none';

    if (historyCleans.length === 0) {
      empty.style.display = 'block';
      return;
    }

    list.innerHTML = '';
    historyCleans.forEach(clean => {
      list.appendChild(createHistoryRow(clean));
    });
  } catch (err) {
    loading.style.display = 'none';
    showError('Failed to load history');
    console.error(err);
  }
}

function createHistoryRow(clean) {
  const row = document.createElement('div');
  row.className = 'history-row';

  const booking = clean.bookings;
  const invoice = clean.invoices;

  // Status badge
  let statusBadge = '';
  if (clean.status === 'complete') {
    statusBadge = '<span class="badge badge-complete">Complete</span>';
  } else if (clean.status === 'cancelled') {
    statusBadge = '<span class="badge badge-cancelled">Cancelled</span>';
  } else {
    statusBadge = '<span class="badge badge-pending">Pending</span>';
  }

  // Invoice info
  let invoiceHtml = '';
  if (invoice) {
    invoiceHtml = `<span class="history-invoice">Inv: ${escapeHtml(invoice.invoice_number)}</span>`;
    if (invoice.status === 'paid') {
      invoiceHtml += '<span class="badge badge-paid">Paid</span>';
    } else {
      invoiceHtml += '<span class="badge badge-pending">Payment pending</span>';
    }
  }

  row.innerHTML = `
    <div class="history-left">
      <div class="history-date">${formatDate(clean.cleaning_date)}</div>
      <div class="history-nights">${booking.nights} night${booking.nights !== 1 ? 's' : ''} &middot; &pound;${clean.rate_amount}</div>
    </div>
    <div class="history-right">
      ${statusBadge}
      ${invoiceHtml}
    </div>`;

  return row;
}

// ══════════════════════════════════════
// ── INVOICE TAB ──
// ══════════════════════════════════════

async function loadInvoiceBadge() {
  try {
    const { data, error } = await supabase
      .from('cleanings')
      .select('id')
      .eq('status', 'complete')
      .is('invoice_id', null);

    if (error) throw error;

    const badge = document.getElementById('invoice-badge');
    const count = (data || []).length;
    if (count > 0) {
      badge.textContent = count;
      badge.style.display = 'inline-flex';
    } else {
      badge.style.display = 'none';
    }
  } catch (err) {
    console.error('Failed to load invoice badge:', err);
  }
}

async function loadInvoice() {
  const loading = document.getElementById('invoice-loading');
  const content = document.getElementById('invoice-content');

  try {
    const { data: cleans, error } = await supabase
      .from('cleanings')
      .select('*, bookings!inner(checkin, checkout, nights, guest_name)')
      .eq('status', 'complete')
      .is('invoice_id', null)
      .order('cleaning_date', { ascending: true });

    if (error) throw error;

    invoiceCleans = cleans || [];
    selectedCleanIds = new Set();
    invoiceFile = null;

    loading.style.display = 'none';
    renderInvoiceContent();
  } catch (err) {
    loading.style.display = 'none';
    showError('Failed to load invoice data');
    console.error(err);
  }
}

function renderInvoiceContent() {
  const content = document.getElementById('invoice-content');

  if (invoiceCleans.length === 0) {
    content.innerHTML = `
      <div class="invoice-no-items">
        <p>No completed cleans waiting to be invoiced.</p>
        <p style="margin-top:8px;font-size:13px;color:#999994 !important;">Complete a clean first, then come back here to create an invoice.</p>
      </div>`;
    return;
  }

  // Step 1: Select cleans
  let selectRowsHtml = invoiceCleans.map(clean => {
    const booking = clean.bookings;
    const checked = selectedCleanIds.has(clean.id) ? 'checked' : '';
    return `
      <div class="invoice-select-row">
        <input type="checkbox" ${checked}
          onchange="toggleCleanSelection('${clean.id}', this.checked)">
        <div class="invoice-select-info">
          <div>
            <div class="invoice-select-date">${formatDate(clean.cleaning_date)}</div>
            <div class="invoice-select-details">${booking.nights} night${booking.nights !== 1 ? 's' : ''} &middot; ${formatRate(clean.rate_type)}</div>
          </div>
          <div class="invoice-select-amount">&pound;${clean.rate_amount}</div>
        </div>
      </div>`;
  }).join('');

  const total = calculateSelectedTotal();
  const selectedCount = selectedCleanIds.size;

  content.innerHTML = `
    <div class="invoice-section">
      <div class="invoice-section-title">Step 1: Select completed cleans</div>
      <div class="select-all-bar">
        <span class="selected-count">${selectedCount} of ${invoiceCleans.length} selected</span>
        <button class="btn btn-select-all" onclick="selectAllCleans()">
          ${selectedCount === invoiceCleans.length ? 'Deselect all' : 'Select all'}
        </button>
      </div>
      ${selectRowsHtml}
      <div class="invoice-total-bar">
        <span>Total</span>
        <span>&pound;${total}</span>
      </div>
    </div>

    <div class="invoice-section" id="invoice-form-section" style="${selectedCount === 0 ? 'opacity:0.5;pointer-events:none;' : ''}">
      <div class="invoice-section-title">Step 2: Invoice details</div>
      <div class="invoice-form" id="invoice-form">
        <div class="form-group">
          <label>Invoice number</label>
          <input type="text" id="invoice-number" placeholder="e.g. INV-001">
        </div>
        <div class="form-group">
          <label>Total amount (&pound;)</label>
          <input type="number" id="invoice-amount" placeholder="0" value="${total}" step="0.01" min="0">
        </div>
        <div class="form-group">
          <label>Upload invoice (PDF, JPG, PNG)</label>
          <div class="file-upload">
            <div class="file-upload-label" id="file-upload-label">
              <span>Choose file or drag here</span>
            </div>
            <input type="file" id="invoice-file" accept=".pdf,.jpg,.jpeg,.png"
              onchange="handleFileSelect(this)">
          </div>
          <div class="file-name" id="file-name-display"></div>
        </div>
        <button class="btn btn-invoice-submit" onclick="submitInvoice()" id="submit-invoice-btn">
          Submit Invoice
        </button>
      </div>
      <div id="invoice-confirmation" style="display:none;"></div>
    </div>`;
}

function toggleCleanSelection(cleanId, checked) {
  if (checked) {
    selectedCleanIds.add(cleanId);
  } else {
    selectedCleanIds.delete(cleanId);
  }
  renderInvoiceContent();
}

function selectAllCleans() {
  if (selectedCleanIds.size === invoiceCleans.length) {
    selectedCleanIds.clear();
  } else {
    invoiceCleans.forEach(c => selectedCleanIds.add(c.id));
  }
  renderInvoiceContent();
}

function calculateSelectedTotal() {
  let total = 0;
  invoiceCleans.forEach(c => {
    if (selectedCleanIds.has(c.id)) {
      total += c.rate_amount || 0;
    }
  });
  return total;
}

function handleFileSelect(input) {
  const file = input.files[0];
  if (file) {
    invoiceFile = file;
    document.getElementById('file-name-display').textContent = file.name;
    document.getElementById('file-upload-label').innerHTML = '<span>File selected</span>';
  }
}

async function submitInvoice() {
  const invoiceNumber = document.getElementById('invoice-number').value.trim();
  const invoiceAmount = document.getElementById('invoice-amount').value;
  const btn = document.getElementById('submit-invoice-btn');

  // Validation
  if (selectedCleanIds.size === 0) {
    showError('Please select at least one cleaning to invoice');
    return;
  }
  if (!invoiceNumber) {
    showError('Please enter an invoice number');
    return;
  }
  if (!invoiceAmount || parseFloat(invoiceAmount) <= 0) {
    showError('Please enter a valid amount');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Submitting...';

  try {
    // Upload file if selected
    let fileUrl = null;
    let fileName = null;

    if (invoiceFile) {
      const ext = invoiceFile.name.split('.').pop();
      const path = `invoices/${invoiceNumber}-${Date.now()}.${ext}`;

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('invoice-uploads')
        .upload(path, invoiceFile, { contentType: invoiceFile.type });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from('invoice-uploads')
        .getPublicUrl(path);

      fileUrl = urlData.publicUrl;
      fileName = invoiceFile.name;
    }

    // Submit via API
    await apiCall('submit_invoice', {
      invoice_number: invoiceNumber,
      amount_pence: Math.round(parseFloat(invoiceAmount) * 100),
      file_url: fileUrl,
      file_name: fileName,
      cleaning_ids: Array.from(selectedCleanIds)
    });

    // Lock form and show confirmation
    const form = document.getElementById('invoice-form');
    form.classList.add('locked');

    const confirmation = document.getElementById('invoice-confirmation');
    confirmation.style.display = 'block';
    confirmation.innerHTML = `
      <div class="invoice-confirmation">
        <div class="check-icon">&#10003;</div>
        <p>Invoice ${escapeHtml(invoiceNumber)} submitted successfully</p>
        <p style="font-size:13px;font-weight:400;color:#777772 !important;margin-top:8px;">
          ${selectedCleanIds.size} clean${selectedCleanIds.size !== 1 ? 's' : ''} linked &middot; &pound;${invoiceAmount}
        </p>
      </div>`;

    // Update badge
    loadInvoiceBadge();

  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Submit Invoice';
    console.error('Invoice submission error:', err);
  }
}
