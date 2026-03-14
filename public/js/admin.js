/* ============================================
   88 Marina — Admin JS
   All admin page logic
   ============================================ */

// ---- Config ----
const SUPABASE_URL = 'https://aagirxlfyjaunqlatiuf.supabase.co';
const SUPABASE_ANON_KEY = ['sb_publishable_jmT7z_nravZZ4Ue', 'PIExrvw_W1z4y3rL'].join('');
const ADMIN_API = '/.netlify/functions/admin-api';

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---- State ----
let settings = {};
let calYear, calMonth; // calendar state

// ---- Init ----
document.addEventListener('DOMContentLoaded', () => {
  initNav();
  initMobileMenu();
  loadSettings().then(() => {
    loadDashboard();
  });
});

// ========================================
// Navigation
// ========================================
function initNav() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const page = item.dataset.page;
      switchPage(page);
      // close mobile menu
      document.getElementById('sidebar').classList.remove('open');
      document.getElementById('sidebarOverlay').classList.remove('visible');
    });
  });
}

function switchPage(page) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelector(`.nav-item[data-page="${page}"]`).classList.add('active');
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(`page-${page}`).classList.add('active');

  // Load data for the page
  switch (page) {
    case 'dashboard': loadDashboard(); break;
    case 'calendar': loadCalendar(); break;
    case 'bookings': loadBookings(); break;
    case 'invoices': loadInvoices(); break;
    case 'checklist': loadChecklist(); break;
    case 'settings': loadSettingsForm(); break;
    case 'sync': loadSyncAudit(); break;
  }
}

function initMobileMenu() {
  const hamburger = document.getElementById('hamburger');
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');

  hamburger.addEventListener('click', () => {
    sidebar.classList.toggle('open');
    overlay.classList.toggle('visible');
  });

  overlay.addEventListener('click', () => {
    sidebar.classList.remove('open');
    overlay.classList.remove('visible');
  });
}

// ========================================
// Helpers
// ========================================
function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

function formatDateShort(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function formatDateTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function daysBetween(dateStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + 'T00:00:00');
  return Math.round((target - today) / (1000 * 60 * 60 * 24));
}

function formatPounds(amount) {
  if (amount == null) return '—';
  return '£' + Number(amount).toLocaleString('en-GB');
}

function formatPence(pence) {
  if (pence == null) return '—';
  return '£' + (pence / 100).toFixed(2);
}

function showToast(message, type = 'success') {
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  requestAnimationFrame(() => toast.classList.add('visible'));
  setTimeout(() => toast.classList.remove('visible'), 3000);
}

async function adminApiCall(action, data = {}) {
  try {
    const resp = await fetch(ADMIN_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...data })
    });
    const result = await resp.json();
    if (!resp.ok) throw new Error(result.error || 'API error');
    return result;
  } catch (err) {
    console.error('Admin API error:', err);
    showToast(err.message, 'error');
    throw err;
  }
}

// ========================================
// Settings (loaded globally)
// ========================================
async function loadSettings() {
  try {
    const { data, error } = await db.from('settings').select('key, value');
    if (error) throw error;
    settings = {};
    (data || []).forEach(s => { settings[s.key] = s.value; });
  } catch (err) {
    console.error('Failed to load settings:', err);
  }
}

// ========================================
// Dashboard
// ========================================
async function loadDashboard() {
  const yearStart = new Date().getFullYear() + '-01-01';
  const yearEnd = new Date().getFullYear() + '-12-31';
  const today = new Date().toISOString().split('T')[0];

  try {
    // Fetch cleanings with booking and invoice data
    const { data: cleanings, error: cErr } = await db
      .from('cleanings')
      .select('*, booking:bookings(*), invoice:invoices(*)');
    if (cErr) throw cErr;

    // Filter out block bookings (Not available / host blocks) from all dashboard views
    const realCleanings = (cleanings || []).filter(c => {
      const b = c.booking;
      if (!b) return true;
      if (b.status === 'block' || b.status === 'dismissed') return false;
      const name = (b.guest_name || '').toLowerCase();
      if (name.includes('not available') || name.includes('unavailable')) return false;
      return true;
    });

    const thisYear = realCleanings.filter(c => c.cleaning_date >= yearStart && c.cleaning_date <= yearEnd);

    // Stats
    const booked = thisYear.filter(c => c.status !== 'cancelled').length;
    const completed = thisYear.filter(c => c.status === 'complete').length;
    const totalCost = thisYear.filter(c => c.status === 'complete').reduce((sum, c) => sum + (c.rate_amount || 0), 0);
    const cancelled = thisYear.filter(c => c.status === 'cancelled').length;
    const cancelPct = booked + cancelled > 0 ? Math.round((cancelled / (booked + cancelled)) * 100) : 0;

    document.getElementById('statBooked').textContent = booked;
    document.getElementById('statCompleted').textContent = completed;
    document.getElementById('statCost').textContent = formatPounds(totalCost);
    document.getElementById('statCancelled').textContent = cancelled;
    document.getElementById('statCancelledPct').textContent = `${cancelPct}% rate`;

    // Next clean hero
    const upcoming = realCleanings
      .filter(c => c.cleaning_date >= today && c.status === 'pending')
      .sort((a, b) => a.cleaning_date.localeCompare(b.cleaning_date));

    const heroEl = document.getElementById('nextCleanHero');
    if (upcoming.length > 0) {
      const next = upcoming[0];
      const days = daysBetween(next.cleaning_date);
      const booking = next.booking;
      const invoice = next.invoice;
      const daysText = days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `In ${days} days`;

      heroEl.innerHTML = `
        <div class="hero-left">
          <div class="hero-date">${formatDate(next.cleaning_date)}</div>
          <div class="hero-countdown">${daysText}</div>
          <div class="hero-details">
            <span class="hero-detail"><strong>Check-in:</strong> ${booking ? formatDateShort(booking.checkin) : '—'}</span>
            <span class="hero-detail"><strong>Check-out:</strong> ${booking ? formatDateShort(booking.checkout) : '—'}</span>
            <span class="hero-detail"><strong>Rate:</strong> ${formatPounds(next.rate_amount)} (${next.rate_type})</span>
            <span class="hero-detail"><strong>Invoice:</strong> ${invoice ? invoice.invoice_number : 'Not yet'}</span>
          </div>
        </div>
        <div class="hero-right">
          <span class="pill pill-green">${daysText}</span>
        </div>
      `;
    } else {
      heroEl.innerHTML = '<div class="hero-loading">No upcoming cleans scheduled</div>';
    }

    // Upcoming cleans list
    const listEl = document.getElementById('upcomingCleansList');
    if (upcoming.length > 0) {
      listEl.innerHTML = upcoming.map(c => {
        const booking = c.booking;
        const days = daysBetween(c.cleaning_date);
        const badges = [];
        if (c.is_new) badges.push('<span class="badge badge-new">New</span>');
        badges.push(`<span class="badge badge-${c.rate_type}">${c.rate_type.replace('_', ' ')}</span>`);
        badges.push(`<span class="badge badge-pending">${c.status}</span>`);
        if (c.added_to_planner) badges.push('<span class="badge badge-planner">In planner</span>');

        return `
          <div class="upcoming-row${c.status === 'cancelled' ? ' cancelled' : ''}">
            <div>
              <div class="upcoming-date">${formatDate(c.cleaning_date)}</div>
              <div class="upcoming-sub">${booking ? booking.guest_name || 'Guest' : '—'} · ${days >= 0 ? `${days}d away` : `${Math.abs(days)}d ago`}</div>
            </div>
            <div class="upcoming-badges">${badges.join('')}</div>
          </div>
        `;
      }).join('');
    } else {
      listEl.innerHTML = '<div class="empty-state">No upcoming cleans</div>';
    }

    // Also show cancelled cleans that haven't been acknowledged
    const cancelledUpcoming = realCleanings.filter(c =>
      c.status === 'cancelled' && c.cleaning_date >= today
    );
    if (cancelledUpcoming.length > 0) {
      cancelledUpcoming.forEach(c => {
        const booking = c.booking;
        listEl.innerHTML += `
          <div class="upcoming-row cancelled">
            <div>
              <div class="upcoming-date">${formatDate(c.cleaning_date)}</div>
              <div class="upcoming-sub">${booking ? booking.guest_name || 'Guest' : '—'}</div>
            </div>
            <div class="upcoming-badges">
              <span class="badge badge-cancelled">Cancelled</span>
            </div>
          </div>
        `;
      });
    }

    // Airbnb blocks flagged for review
    await loadBlockFlags();

    // WhatsApp card
    await loadWhatsAppCard(upcoming);

    // Invoice action cards
    await loadInvoiceActions();

  } catch (err) {
    console.error('Dashboard load error:', err);
    showToast('Failed to load dashboard', 'error');
  }
}

async function loadBlockFlags() {
  const container = document.getElementById('blockFlags');
  if (!container) return;
  try {
    const today = new Date().toISOString().split('T')[0];
    const { data: blocks, error } = await db
      .from('bookings')
      .select('*')
      .eq('status', 'block')
      .gte('checkout', today)
      .order('checkin', { ascending: true });
    if (error) throw error;

    if (!blocks || blocks.length === 0) {
      container.innerHTML = '';
      return;
    }

    container.innerHTML = '<h3 class="card-title" style="margin-bottom:12px !important;">Blocked dates to review</h3>' +
      blocks.map(b => `
        <div class="block-flag" id="block-${b.id}">
          <div class="block-flag-info">
            <div class="block-flag-title">${formatDateShort(b.checkin)} → ${formatDateShort(b.checkout)} (${b.nights || '?'} nights)</div>
            <div class="block-flag-sub">${escapeHtml(b.guest_name)} — Does this need a clean?</div>
          </div>
          <div class="block-flag-actions">
            <button class="btn btn-green btn-sm" onclick="convertBlockToClean('${b.id}')">Book clean</button>
            <button class="btn btn-dark btn-sm" onclick="dismissBlock('${b.id}')">Dismiss</button>
          </div>
        </div>
      `).join('');
  } catch (err) {
    console.error('Block flags error:', err);
  }
}

async function convertBlockToClean(bookingId) {
  try {
    // Get the block booking details
    const { data: booking } = await db.from('bookings').select('*').eq('id', bookingId).single();
    if (!booking) return;

    // Convert to confirmed and add clean
    await adminApiCall('add_manual_clean', {
      guest_name: 'Block clean',
      checkin: booking.checkin,
      checkout: booking.checkout,
      cleaning_date: booking.checkout,
      rate_type: 'standard',
      rate_amount: parseInt(settings.rate_standard) || 0
    });

    // Remove the block booking
    await db.from('bookings').delete().eq('id', bookingId);

    showToast('Clean booked for blocked dates');
    const el = document.getElementById('block-' + bookingId);
    if (el) el.remove();
  } catch (err) {
    showToast('Failed to convert block', 'error');
  }
}

async function dismissBlock(bookingId) {
  try {
    await db.from('bookings').update({ status: 'dismissed' }).eq('id', bookingId);
    showToast('Block dismissed');
    const el = document.getElementById('block-' + bookingId);
    if (el) el.remove();
  } catch (err) {
    showToast('Failed to dismiss block', 'error');
  }
}

async function loadWhatsAppCard(upcomingCleans) {
  const contentEl = document.getElementById('whatsappContent');
  const propertyName = settings.property_name || '88 Marina';
  const template = settings.whatsapp_template || 'Hi, upcoming dates at {property}: {dates}';

  // Get last WhatsApp sent timestamp from settings
  const lastSent = settings.last_whatsapp_sent || null;

  // Count new dates since last sent
  let newCount = 0;
  const futureDates = (upcomingCleans || []).map(c => c.cleaning_date);

  if (lastSent) {
    newCount = (upcomingCleans || []).filter(c => c.created_at > lastSent).length;
  } else {
    newCount = futureDates.length;
  }

  // Build message
  const datesStr = futureDates.map(d => formatDate(d)).join('\n- ');
  const message = template
    .replace('{property}', propertyName)
    .replace('{dates}', datesStr ? '\n- ' + datesStr : 'No upcoming dates');

  contentEl.innerHTML = `
    <div class="whatsapp-count">
      <strong>${newCount}</strong> new date${newCount !== 1 ? 's' : ''} since last WhatsApp${lastSent ? ' (' + formatDateTime(lastSent) + ')' : ''}
    </div>
    <div class="whatsapp-preview">${escapeHtml(message)}</div>
    <button class="btn btn-green" onclick="sendWhatsApp('${encodeURIComponent(message)}')">Send via WhatsApp</button>
  `;
}

function sendWhatsApp(encodedMessage) {
  window.open(`https://wa.me/?text=${encodedMessage}`, '_blank');
  // Record timestamp
  adminApiCall('record_whatsapp')
    .then(() => {
      settings.last_whatsapp_sent = new Date().toISOString();
      showToast('WhatsApp opened — timestamp recorded');
    })
    .catch(() => {});
}

async function loadInvoiceActions() {
  const container = document.getElementById('invoiceActions');
  try {
    const { data: invoices, error } = await db
      .from('invoices')
      .select('*')
      .eq('status', 'pending');
    if (error) throw error;

    if (!invoices || invoices.length === 0) {
      container.innerHTML = '';
      return;
    }

    container.innerHTML = invoices.map(inv => `
      <div class="invoice-action-card" id="inv-action-${inv.id}">
        <h3 class="card-title">Invoice #${escapeHtml(inv.invoice_number)}</h3>
        <div class="invoice-action-info">Submitted ${formatDateTime(inv.submitted_at)}</div>
        <div class="invoice-action-amount">${formatPence(inv.amount_pence)}</div>
        ${inv.file_url ? `<div class="invoice-action-info"><a href="${inv.file_url}" target="_blank" style="color: #1A6EBF !important;">View invoice file</a></div>` : ''}
        <button class="btn btn-amber" onclick="markInvoicePaid('${inv.id}')">Mark as paid</button>
      </div>
    `).join('');
  } catch (err) {
    console.error('Invoice actions error:', err);
  }
}

async function markInvoicePaid(invoiceId) {
  try {
    await adminApiCall('mark_invoice_paid', { invoice_id: invoiceId });
    showToast('Invoice marked as paid');
    const card = document.getElementById(`inv-action-${invoiceId}`);
    if (card) {
      card.style.opacity = '0.4';
      card.innerHTML += '<div style="padding-top: 8px; color: #2D9B5A !important; font-weight: 600;">Paid</div>';
    }
  } catch (err) {
    // toast shown by adminApiCall
  }
}

// ========================================
// Calendar
// ========================================
function loadCalendar() {
  const now = new Date();
  if (!calYear) calYear = now.getFullYear();
  if (!calMonth) calMonth = now.getMonth();

  document.getElementById('calPrev').onclick = () => {
    calMonth--;
    if (calMonth < 0) { calMonth = 11; calYear--; }
    renderCalendar();
  };
  document.getElementById('calNext').onclick = () => {
    calMonth++;
    if (calMonth > 11) { calMonth = 0; calYear++; }
    renderCalendar();
  };

  renderCalendar();
}

async function renderCalendar() {
  const grid = document.getElementById('calendarGrid');
  const label = document.getElementById('calMonthLabel');
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  label.textContent = `${monthNames[calMonth]} ${calYear}`;

  // Calculate grid dates (Mon-Sun)
  const firstDay = new Date(calYear, calMonth, 1);
  const lastDay = new Date(calYear, calMonth + 1, 0);
  let startDow = firstDay.getDay(); // 0=Sun
  startDow = startDow === 0 ? 6 : startDow - 1; // convert to Mon=0

  const gridStart = new Date(firstDay);
  gridStart.setDate(gridStart.getDate() - startDow);

  const totalCells = Math.ceil((startDow + lastDay.getDate()) / 7) * 7;
  const gridDates = [];
  for (let i = 0; i < totalCells; i++) {
    const d = new Date(gridStart);
    d.setDate(d.getDate() + i);
    gridDates.push(d);
  }

  // Fetch bookings and cleanings for visible range
  const rangeStart = gridDates[0].toISOString().split('T')[0];
  const rangeEnd = gridDates[gridDates.length - 1].toISOString().split('T')[0];

  let bookings = [], cleanings = [];
  try {
    const { data: bData } = await db
      .from('bookings')
      .select('*')
      .or(`checkin.lte.${rangeEnd},checkout.gte.${rangeStart}`);
    bookings = bData || [];

    const { data: cData } = await db
      .from('cleanings')
      .select('*, booking:bookings(*)')
      .gte('cleaning_date', rangeStart)
      .lte('cleaning_date', rangeEnd);
    cleanings = cData || [];
  } catch (err) {
    console.error('Calendar data error:', err);
  }

  // Build spans for bookings
  const spans = [];
  bookings.forEach(b => {
    // For bookings, the span covers checkin to checkout
    // Checkin day = first night, checkout day = guest leaves (half-day)
    spans.push({
      type: b.status === 'cancelled' ? 'cancelled' : (b.status === 'block' ? 'block' : 'booking'),
      start: b.checkin,
      end: b.checkout,
      label: b.guest_name || 'Guest',
      booking: b
    });
  });
  cleanings.forEach(c => {
    spans.push({
      type: 'clean',
      start: c.cleaning_date,
      end: c.cleaning_date,
      label: 'Clean',
      cleaning: c,
      booking: c.booking
    });
  });

  // Assign rows to spans to handle overlaps
  const dateToStr = d => d.toISOString().split('T')[0];
  const todayStr = dateToStr(new Date());

  // Build day map for spans
  const daySpans = {}; // dateStr -> [{span, row}]
  gridDates.forEach(d => { daySpans[dateToStr(d)] = []; });

  // For row allocation, we need to consider that checkout day only uses left half
  // and checkin day only uses right half, so they don't conflict on same day
  spans.forEach(span => {
    const s = new Date(span.start + 'T00:00:00');
    const e = new Date(span.end + 'T00:00:00');
    // Find the first row that doesn't conflict
    let row = 0;
    let placed = false;
    while (!placed && row < 4) {
      let conflict = false;
      const cur = new Date(s);
      while (cur <= e) {
        const key = dateToStr(cur);
        if (daySpans[key]) {
          for (const existing of daySpans[key]) {
            if (existing.row !== row) continue;
            // Check if they actually conflict considering half-widths
            const curIsStart = key === span.start;
            const curIsEnd = key === span.end;
            const exIsStart = key === existing.span.start;
            const exIsEnd = key === existing.span.end;
            // checkin (start) uses right half, checkout (end) uses left half
            // A checkout (left half) + checkin (right half) on same day don't conflict
            const spanUsesLeft = !curIsStart || (curIsStart && curIsEnd);
            const spanUsesRight = !curIsEnd || (curIsStart && curIsEnd);
            const exUsesLeft = !exIsStart || (exIsStart && exIsEnd);
            const exUsesRight = !exIsEnd || (exIsStart && exIsEnd);
            // For single-day spans (clean), they use full width
            const spanSingleDay = span.start === span.end;
            const exSingleDay = existing.span.start === existing.span.end;
            if (spanSingleDay || exSingleDay) {
              conflict = true;
              break;
            }
            // Checkout (end only) uses left, checkin (start only) uses right
            if (curIsEnd && !curIsStart && exIsStart && !exIsEnd) continue; // no conflict
            if (curIsStart && !curIsEnd && exIsEnd && !exIsStart) continue; // no conflict
            conflict = true;
            break;
          }
          if (conflict) break;
        }
        cur.setDate(cur.getDate() + 1);
      }
      if (!conflict) {
        placed = true;
        const cur2 = new Date(s);
        while (cur2 <= e) {
          const key = dateToStr(cur2);
          if (daySpans[key]) {
            daySpans[key].push({ span, row });
          }
          cur2.setDate(cur2.getDate() + 1);
        }
      } else {
        row++;
      }
    }
    span._row = row;
  });

  // Render grid
  const headers = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  let html = headers.map(h => `<div class="cal-header">${h}</div>`).join('');

  gridDates.forEach((d, i) => {
    const ds = dateToStr(d);
    const isOther = d.getMonth() !== calMonth;
    const isToday = ds === todayStr;
    let classes = 'cal-day';
    if (isOther) classes += ' other-month';
    if (isToday) classes += ' today';

    // Build bars for this day
    const dayData = daySpans[ds] || [];
    const maxRow = dayData.length > 0 ? Math.max(...dayData.map(x => x.row)) : -1;
    // Set min-height based on number of rows
    const barsHeight = maxRow >= 0 ? ((maxRow + 1) * 22 + 2) : 0;

    let barsHtml = `<div class="cal-bars" style="min-height:${Math.max(barsHeight, 22)}px">`;
    for (let r = 0; r <= Math.min(maxRow, 3); r++) {
      // There may be multiple entries at the same row on the same day (checkout + checkin)
      const entries = dayData.filter(x => x.row === r);
      if (entries.length > 0) {
        for (const entry of entries) {
          const span = entry.span;
          const isStart = ds === span.start;
          const isEnd = ds === span.end;
          const isSingleDay = span.start === span.end;

          // Determine half-width class
          let posClass = 'full-width';
          if (!isSingleDay) {
            if (isStart && isEnd) {
              posClass = 'full-width'; // shouldn't happen for multi-day
            } else if (isStart) {
              posClass = 'half-right'; // checkin day: right half
            } else if (isEnd) {
              posClass = 'half-left';  // checkout day: left half
            }
          }

          // Rounded ends only at actual booking start/end, not at week boundaries
          let roundClass = '';
          if (isStart) roundClass += ' round-left';
          if (isEnd) roundClass += ' round-right';
          if (isSingleDay) roundClass = ' round-left round-right';

          const barType = span.type === 'clean' ? 'cal-bar-clean' :
                          span.type === 'cancelled' ? 'cal-bar-cancelled' :
                          span.type === 'block' ? 'cal-bar-cancelled' : 'cal-bar-booking';
          const showLabel = isStart || (d.getDay() === 1 && !isStart);
          const labelText = showLabel ? escapeHtml(span.label) : '';
          const dataAttr = `data-span='${JSON.stringify({
            guestName: span.label,
            checkin: span.booking ? span.booking.checkin : span.start,
            checkout: span.booking ? span.booking.checkout : span.end,
            nights: span.booking ? span.booking.nights : null,
            status: span.booking ? span.booking.status : (span.cleaning ? span.cleaning.status : ''),
            cleanDate: span.cleaning ? span.cleaning.cleaning_date : null,
            type: span.type
          }).replace(/'/g, '&#39;')}'`;

          barsHtml += `<div class="cal-bar ${barType} ${posClass} row-${r} ${roundClass.trim()}" ${dataAttr} onclick="showCalPopup(this)">${labelText}</div>`;
        }
      }
    }
    barsHtml += '</div>';

    html += `<div class="${classes}"><div class="cal-day-num">${d.getDate()}</div>${barsHtml}</div>`;
  });

  grid.innerHTML = html;

  // Popup handlers
  document.getElementById('calPopupClose').onclick = closeCalPopup;
  document.getElementById('calPopupOverlay').onclick = (e) => {
    if (e.target === document.getElementById('calPopupOverlay')) closeCalPopup();
  };
}

function showCalPopup(el) {
  const data = JSON.parse(el.dataset.span);
  const content = document.getElementById('calPopupContent');
  content.innerHTML = `
    <h3>${escapeHtml(data.guestName)}</h3>
    <div class="cal-popup-row">
      <span class="cal-popup-label">Check-in</span>
      <span class="cal-popup-value">${formatDate(data.checkin)}</span>
    </div>
    <div class="cal-popup-row">
      <span class="cal-popup-label">Check-out</span>
      <span class="cal-popup-value">${formatDate(data.checkout)}</span>
    </div>
    <div class="cal-popup-row">
      <span class="cal-popup-label">Nights</span>
      <span class="cal-popup-value">${data.nights || '—'}</span>
    </div>
    <div class="cal-popup-row">
      <span class="cal-popup-label">Status</span>
      <span class="cal-popup-value">
        <span class="badge badge-${data.status === 'confirmed' ? 'complete' : data.status === 'cancelled' ? 'cancelled' : 'pending'}">${data.status || '—'}</span>
      </span>
    </div>
    ${data.cleanDate ? `
    <div class="cal-popup-row">
      <span class="cal-popup-label">Clean date</span>
      <span class="cal-popup-value">${formatDate(data.cleanDate)}</span>
    </div>` : ''}
  `;
  document.getElementById('calPopupOverlay').classList.add('visible');
}

function closeCalPopup() {
  document.getElementById('calPopupOverlay').classList.remove('visible');
}

// ========================================
// Bookings
// ========================================
async function loadBookings() {
  const tbody = document.getElementById('bookingsBody');
  tbody.innerHTML = '<tr><td colspan="11" class="loading-placeholder">Loading...</td></tr>';

  try {
    // Fetch cleanings (real bookings with cleans)
    const { data: cleaningsData, error: cErr } = await db
      .from('cleanings')
      .select('*, booking:bookings(*), invoice:invoices(*)')
      .order('cleaning_date', { ascending: false });
    if (cErr) throw cErr;

    // Also fetch block/dismissed bookings (no cleaning record)
    const { data: blockData, error: bErr } = await db
      .from('bookings')
      .select('*')
      .in('status', ['block', 'dismissed'])
      .order('checkin', { ascending: false });
    if (bErr) throw bErr;

    // Build combined rows
    const rows = [];

    // Add cleaning rows
    (cleaningsData || []).forEach(c => {
      const b = c.booking;
      const name = (b?.guest_name || '').toLowerCase();
      let airbnbLabel = 'Reserved';
      if (name.includes('not available') || name.includes('unavailable')) {
        airbnbLabel = 'Not available';
      } else if (b?.airbnb_uid?.startsWith('manual-')) {
        airbnbLabel = 'Manual';
      }
      rows.push({
        sortDate: c.cleaning_date,
        type: 'cleaning',
        cleaning: c,
        booking: b,
        invoice: c.invoice,
        airbnbLabel
      });
    });

    // Add block rows (no cleaning record)
    (blockData || []).forEach(b => {
      rows.push({
        sortDate: b.checkin,
        type: 'block',
        cleaning: null,
        booking: b,
        invoice: null,
        airbnbLabel: 'Not available'
      });
    });

    // Sort by most recent first
    rows.sort((a, b) => b.sortDate.localeCompare(a.sortDate));

    if (rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="11" class="empty-state">No bookings found</td></tr>';
      return;
    }

    tbody.innerHTML = rows.map(row => {
      const b = row.booking;
      const c = row.cleaning;
      const inv = row.invoice;

      if (row.type === 'block') {
        // Block row — no cleaning
        const statusBadge = b.status === 'dismissed'
          ? '<span class="badge badge-grey" style="background-color:#e8e5e0 !important; color:#999 !important;">Dismissed</span>'
          : '<span class="badge badge-pending">Block</span>';
        return `<tr style="opacity:0.6;">
          <td>—</td>
          <td>${formatDateShort(b.checkin)}</td>
          <td>${formatDateShort(b.checkout)}</td>
          <td><span class="badge badge-pending">Not available</span></td>
          <td>—</td>
          <td>${statusBadge}</td>
          <td>—</td>
          <td>—</td>
          <td>—</td>
          <td>—</td>
          <td>—</td>
        </tr>`;
      }

      // Normal cleaning row
      const isCancelled = c.status === 'cancelled';
      const labelBadge = row.airbnbLabel === 'Reserved'
        ? '<span class="badge badge-complete">Reserved</span>'
        : row.airbnbLabel === 'Manual'
          ? '<span class="badge badge-planner">Manual</span>'
          : '<span class="badge badge-pending">Not available</span>';

      return `<tr>
        <td>${formatDate(c.cleaning_date)}</td>
        <td>${b ? formatDateShort(b.checkin) : '—'}</td>
        <td>${b ? formatDateShort(b.checkout) : '—'}</td>
        <td>${labelBadge}</td>
        <td>${formatPounds(c.rate_amount)}</td>
        <td><span class="badge badge-${c.status === 'complete' ? 'complete' : c.status === 'cancelled' ? 'cancelled' : 'pending'}">${c.status}</span></td>
        <td>${c.added_to_planner ? '<span class="badge badge-planner">Yes</span>' : '<span class="badge badge-grey" style="background-color:#e8e5e0 !important; color:#999 !important;">No</span>'}</td>
        <td>${inv ? inv.invoice_number : '—'}</td>
        <td>${inv ? (inv.status === 'paid' ? '<span class="badge badge-complete">Paid</span>' : '<span class="badge badge-pending">Pending</span>') : '—'}</td>
        <td>${isCancelled ? (c.cancellation_acknowledged ? '<span class="badge badge-complete">Yes</span>' : '<span class="badge badge-pending">Pending</span>') : '—'}</td>
        <td><button class="btn btn-red btn-sm" onclick="removeClean('${c.id}')">Remove</button></td>
      </tr>`;
    }).join('');
  } catch (err) {
    console.error('Bookings load error:', err);
    tbody.innerHTML = '<tr><td colspan="11" class="loading-placeholder">Failed to load bookings</td></tr>';
  }
}

// ========================================
// Invoices
// ========================================
async function loadInvoices() {
  try {
    const { data: invoices, error } = await db
      .from('invoices')
      .select('*')
      .order('submitted_at', { ascending: false });
    if (error) throw error;

    // Stats
    const allInvoices = invoices || [];
    const totalInvoiced = allInvoices.reduce((s, i) => s + (i.amount_pence || 0), 0);
    const totalPaid = allInvoices.filter(i => i.status === 'paid').reduce((s, i) => s + (i.amount_pence || 0), 0);
    const outstanding = totalInvoiced - totalPaid;

    document.getElementById('statInvoiced').textContent = formatPence(totalInvoiced);
    document.getElementById('statPaid').textContent = formatPence(totalPaid);
    document.getElementById('statOutstanding').textContent = formatPence(outstanding);

    // Get cleaning dates per invoice
    const invoiceIds = allInvoices.map(i => i.id);
    let cleaningsByInvoice = {};
    if (invoiceIds.length > 0) {
      const { data: cleanings } = await db
        .from('cleanings')
        .select('invoice_id, cleaning_date, rate_type')
        .in('invoice_id', invoiceIds);
      (cleanings || []).forEach(c => {
        if (!cleaningsByInvoice[c.invoice_id]) cleaningsByInvoice[c.invoice_id] = [];
        cleaningsByInvoice[c.invoice_id].push(c);
      });
    }

    const tbody = document.getElementById('invoicesBody');
    if (allInvoices.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No invoices yet</td></tr>';
      return;
    }

    tbody.innerHTML = allInvoices.map(inv => {
      const relCleanings = cleaningsByInvoice[inv.id] || [];
      const dates = relCleanings.map(c => formatDateShort(c.cleaning_date)).join(', ') || '—';
      const rateTypes = [...new Set(relCleanings.map(c => c.rate_type))].join(', ') || '—';
      const isPaid = inv.status === 'paid';

      return `<tr>
        <td><strong>${escapeHtml(inv.invoice_number)}</strong></td>
        <td>${dates}</td>
        <td>${rateTypes}</td>
        <td>${formatPence(inv.amount_pence)}</td>
        <td><span class="badge badge-${isPaid ? 'complete' : 'pending'}">${isPaid ? 'Paid' : 'Pending'}</span>
          ${isPaid && inv.paid_at ? '<br><small style="color:#999994 !important;">' + formatDateTime(inv.paid_at) + '</small>' : ''}
        </td>
        <td>${isPaid ? '—' : `<button class="btn btn-amber btn-sm" onclick="markInvoicePaidFromTable('${inv.id}')">Mark paid</button>`}</td>
      </tr>`;
    }).join('');
  } catch (err) {
    console.error('Invoices load error:', err);
    showToast('Failed to load invoices', 'error');
  }
}

async function markInvoicePaidFromTable(invoiceId) {
  try {
    await adminApiCall('mark_invoice_paid', { invoice_id: invoiceId });
    showToast('Invoice marked as paid');
    loadInvoices();
  } catch (err) {
    // toast shown
  }
}

// ========================================
// Checklist
// ========================================
let checklistData = [];

async function loadChecklist() {
  try {
    const { data, error } = await db
      .from('checklist_items')
      .select('*')
      .eq('active', true)
      .order('sort_order', { ascending: true });
    if (error) throw error;

    checklistData = data || [];
    renderChecklist();
  } catch (err) {
    console.error('Checklist load error:', err);
  }
}

function renderChecklist() {
  const container = document.getElementById('checklistItems');
  if (checklistData.length === 0) {
    container.innerHTML = '<div class="empty-state">No checklist items. Add one below.</div>';
    return;
  }

  container.innerHTML = checklistData.map((item, idx) => `
    <div class="checklist-row" draggable="true" data-idx="${idx}">
      <span class="checklist-drag">☰</span>
      <input type="text" class="checklist-input" value="${escapeHtml(item.label)}" data-id="${item.id}">
      <button class="checklist-remove" onclick="removeChecklistItem(${idx})" title="Remove">&times;</button>
    </div>
  `).join('');

  // Drag and drop
  const rows = container.querySelectorAll('.checklist-row');
  let dragSrc = null;

  rows.forEach(row => {
    row.addEventListener('dragstart', (e) => {
      dragSrc = row;
      row.style.opacity = '0.4';
      e.dataTransfer.effectAllowed = 'move';
    });

    row.addEventListener('dragend', () => {
      row.style.opacity = '1';
      rows.forEach(r => r.classList.remove('drag-over'));
    });

    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      row.classList.add('drag-over');
    });

    row.addEventListener('dragleave', () => {
      row.classList.remove('drag-over');
    });

    row.addEventListener('drop', (e) => {
      e.preventDefault();
      row.classList.remove('drag-over');
      if (dragSrc !== row) {
        const srcIdx = parseInt(dragSrc.dataset.idx);
        const destIdx = parseInt(row.dataset.idx);
        const moved = checklistData.splice(srcIdx, 1)[0];
        checklistData.splice(destIdx, 0, moved);
        renderChecklist();
      }
    });
  });
}

function removeChecklistItem(idx) {
  const item = checklistData[idx];
  if (item.id) {
    // Mark for deletion
    item._deleted = true;
  }
  checklistData.splice(idx, 1);
  renderChecklist();
}

document.getElementById('addChecklistItem').addEventListener('click', () => {
  checklistData.push({ id: null, label: '', sort_order: checklistData.length + 1 });
  renderChecklist();
  // Focus the new input
  const inputs = document.querySelectorAll('.checklist-input');
  if (inputs.length > 0) inputs[inputs.length - 1].focus();
});

document.getElementById('saveChecklist').addEventListener('click', async () => {
  // Read current values from inputs
  const inputs = document.querySelectorAll('.checklist-input');
  const items = [];
  inputs.forEach((input, idx) => {
    items.push({
      id: input.dataset.id !== 'null' && input.dataset.id ? input.dataset.id : null,
      label: input.value.trim(),
      sort_order: idx + 1
    });
  });

  try {
    await adminApiCall('save_checklist', { items });
    showToast('Checklist saved');
    loadChecklist();
  } catch (err) {
    // toast shown
  }
});

// ========================================
// Settings
// ========================================
function loadSettingsForm() {
  const form = document.getElementById('settingsForm');
  form.querySelectorAll('[data-key]').forEach(field => {
    const key = field.dataset.key;
    if (settings[key] !== undefined) {
      field.value = settings[key];
    }
  });

  // WhatsApp preview
  updateWhatsAppPreview();
  const templateField = document.getElementById('setting_whatsapp_template');
  templateField.addEventListener('input', updateWhatsAppPreview);
}

async function updateWhatsAppPreview() {
  const template = document.getElementById('setting_whatsapp_template').value;
  const propertyName = document.getElementById('setting_property_name').value || settings.property_name || '88 Marina';

  // Get upcoming dates for preview
  let dates = 'Mon 20 Jan, Fri 24 Jan, Mon 3 Feb';
  try {
    const today = new Date().toISOString().split('T')[0];
    const { data } = await db
      .from('cleanings')
      .select('cleaning_date')
      .gte('cleaning_date', today)
      .eq('status', 'pending')
      .order('cleaning_date')
      .limit(5);
    if (data && data.length > 0) {
      dates = data.map(c => formatDateShort(c.cleaning_date)).join(', ');
    }
  } catch (e) { /* use placeholder */ }

  const preview = template
    .replace('{property}', propertyName)
    .replace('{dates}', dates);

  document.getElementById('whatsappPreview').textContent = preview;
}

document.getElementById('settingsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const updates = {};
  form.querySelectorAll('[data-key]').forEach(field => {
    updates[field.dataset.key] = field.value;
  });

  try {
    await adminApiCall('save_settings', { settings: updates });
    // Update local cache
    Object.assign(settings, updates);
    showToast('Settings saved');
  } catch (err) {
    // toast shown
  }
});

// ========================================
// Sync & Audit
// ========================================
async function loadSyncAudit() {
  // Sync log
  try {
    const { data: syncLogs, error: sErr } = await db
      .from('sync_log')
      .select('*')
      .order('synced_at', { ascending: false })
      .limit(50);
    if (sErr) throw sErr;

    const syncEl = document.getElementById('syncLogList');
    if (!syncLogs || syncLogs.length === 0) {
      syncEl.innerHTML = '<div class="empty-state">No sync logs yet</div>';
    } else {
      syncEl.innerHTML = syncLogs.map(log => {
        let colorClass = 'log-blue';
        if (log.bookings_added > 0) colorClass = 'log-green';
        if (log.bookings_cancelled > 0) colorClass = 'log-red';
        if (log.bookings_added > 0 && log.bookings_cancelled > 0) colorClass = 'log-green';
        if (log.bookings_added === 0 && log.bookings_cancelled === 0) colorClass = 'log-blue';

        return `
          <div class="log-entry ${colorClass}">
            <span class="log-time">${formatDateTime(log.synced_at)}</span>
            <span class="log-text">
              <strong style="color: #2D9B5A !important;">${log.bookings_added} added</strong>,
              <strong style="color: #C94040 !important;">${log.bookings_cancelled} cancelled</strong>
              ${log.notes ? ` — ${escapeHtml(log.notes)}` : ''}
            </span>
          </div>
        `;
      }).join('');
    }
  } catch (err) {
    console.error('Sync log error:', err);
    document.getElementById('syncLogList').innerHTML = '<div class="loading-placeholder">Failed to load sync log</div>';
  }

  // Audit log
  try {
    const { data: auditLogs, error: aErr } = await db
      .from('audit_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);
    if (aErr) throw aErr;

    const auditEl = document.getElementById('auditLogList');
    if (!auditLogs || auditLogs.length === 0) {
      auditEl.innerHTML = '<div class="empty-state">No audit entries yet</div>';
    } else {
      auditEl.innerHTML = auditLogs.map(log => {
        const actionLabels = {
          'marked_complete': 'Marked clean as complete',
          'added_to_planner': 'Added to planner',
          'invoice_submitted': 'Invoice submitted',
          'cancellation_acknowledged': 'Cancellation acknowledged',
          'checklist_updated': 'Checklist updated',
          'settings_updated': 'Settings updated'
        };
        const label = actionLabels[log.action] || log.action;

        return `
          <div class="log-entry log-default">
            <span class="log-time">${formatDateTime(log.created_at)}</span>
            <span class="log-text">${escapeHtml(label)}${log.detail ? ' — ' + escapeHtml(log.detail) : ''}</span>
          </div>
        `;
      }).join('');
    }
  } catch (err) {
    console.error('Audit log error:', err);
    document.getElementById('auditLogList').innerHTML = '<div class="loading-placeholder">Failed to load audit log</div>';
  }

  // Sync now button
  document.getElementById('syncNowBtn').onclick = async () => {
    const btn = document.getElementById('syncNowBtn');
    btn.disabled = true;
    btn.textContent = 'Syncing...';
    try {
      await adminApiCall('trigger_sync');
      showToast('Sync triggered successfully');
      setTimeout(() => loadSyncAudit(), 2000);
    } catch (err) {
      // toast shown
    } finally {
      btn.disabled = false;
      btn.textContent = 'Sync now';
    }
  };
}

// ========================================
// Manual Add / Remove Clean
// ========================================
function showAddCleanModal() {
  document.getElementById('addCleanOverlay').classList.add('visible');
  // Pre-fill rate from settings
  const rateType = document.getElementById('manualRateType');
  rateType.value = 'standard';
  document.getElementById('manualRateAmount').value = settings.rate_standard || '';
  rateType.onchange = () => {
    const key = 'rate_' + rateType.value;
    document.getElementById('manualRateAmount').value = settings[key] || '';
  };
  // Auto-set clean date when checkout changes
  document.getElementById('manualCheckout').onchange = () => {
    document.getElementById('manualCleanDate').value = document.getElementById('manualCheckout').value;
  };
}

function closeAddCleanModal() {
  document.getElementById('addCleanOverlay').classList.remove('visible');
}

async function submitManualClean() {
  const guestName = document.getElementById('manualGuestName').value.trim();
  const checkin = document.getElementById('manualCheckin').value;
  const checkout = document.getElementById('manualCheckout').value;
  const cleanDate = document.getElementById('manualCleanDate').value;
  const rateType = document.getElementById('manualRateType').value;
  const rateAmount = document.getElementById('manualRateAmount').value;
  const btn = document.getElementById('submitManualCleanBtn');

  if (!checkin || !checkout || !cleanDate) {
    showToast('Please fill in all date fields', 'error');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Adding...';

  try {
    await adminApiCall('add_manual_clean', {
      guest_name: guestName || 'Manual booking',
      checkin,
      checkout,
      cleaning_date: cleanDate,
      rate_type: rateType,
      rate_amount: parseInt(rateAmount) || 0
    });
    showToast('Clean added successfully');
    closeAddCleanModal();
    loadBookings();
  } catch (err) {
    // toast shown by adminApiCall
  } finally {
    btn.disabled = false;
    btn.textContent = 'Add clean';
  }
}

async function removeClean(cleaningId) {
  if (!confirm('Remove this clean? This cannot be undone.')) return;

  try {
    await adminApiCall('remove_clean', { cleaning_id: cleaningId });
    showToast('Clean removed');
    loadBookings();
  } catch (err) {
    // toast shown
  }
}

// ========================================
// Utility
// ========================================
function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
