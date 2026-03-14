const { createClient } = require('@supabase/supabase-js');
const https = require('https');
const http = require('http');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

exports.handler = async (event) => {
  try {
    // 1. Get settings
    const { data: settings } = await supabase
      .from('settings')
      .select('key, value');
    const cfg = Object.fromEntries(settings.map(s => [s.key, s.value]));

    if (!cfg.ical_url) {
      console.log('No iCal URL configured');
      return { statusCode: 200, body: JSON.stringify({ message: 'No iCal URL configured' }) };
    }

    // 2. Fetch and parse iCal
    const icalText = await fetchUrl(cfg.ical_url);
    const events = parseICal(icalText);

    // 3. Get existing bookings
    const { data: existing } = await supabase
      .from('bookings')
      .select('*');

    const existingMap = Object.fromEntries((existing || []).map(b => [b.airbnb_uid, b]));
    const incomingUids = new Set(events.map(e => e.uid));

    let added = 0, cancelled = 0;
    const addedBookings = [], cancelledBookings = [];

    // 3b. Retroactive cleanup: remove cleanings linked to "Not available" bookings
    // that were synced before the block filter was added
    for (const existing_b of (existing || [])) {
      const name = (existing_b.guest_name || '').toLowerCase();
      if ((name.includes('not available') || name.includes('unavailable')) && existing_b.status === 'confirmed') {
        // Remove associated cleanings
        await supabase.from('cleanings').delete().eq('booking_id', existing_b.id);
        // Update booking status to block or delete if 1 night
        const ci = new Date(existing_b.checkin + 'T00:00:00');
        const co = new Date(existing_b.checkout + 'T00:00:00');
        const n = Math.round((co - ci) / (1000 * 60 * 60 * 24));
        if (n >= 2) {
          await supabase.from('bookings').update({ status: 'block', nights: n }).eq('id', existing_b.id);
        } else {
          await supabase.from('bookings').delete().eq('id', existing_b.id);
        }
      }
    }

    // 4. Add new bookings
    // Airbnb iCal uses two summary types:
    //   "Reserved" = real guest booking → create clean
    //   "Not available" = Airbnb auto-block or host block → skip but flag if 2+ nights
    for (const event of events) {
      const summaryLower = (event.summary || '').toLowerCase();
      const isBlock = summaryLower.includes('not available') || summaryLower.includes('unavailable');
      const checkinDate = new Date(event.checkin + 'T00:00:00');
      const checkoutDate = new Date(event.checkout + 'T00:00:00');
      const nights = Math.round((checkoutDate - checkinDate) / (1000 * 60 * 60 * 24));

      if (!existingMap[event.uid] && isBlock) {
        // It's a block — store it as a block record so admin can review
        if (nights >= 2) {
          await supabase.from('bookings').insert({
            airbnb_uid: event.uid,
            guest_name: event.summary || 'Not available',
            checkin: event.checkin,
            checkout: event.checkout,
            status: 'block',
            nights: nights
          });
        }
        continue; // Don't create a clean for blocks
      }

      if (!existingMap[event.uid]) {
        const { data: booking, error: bookingErr } = await supabase
          .from('bookings')
          .insert({
            airbnb_uid: event.uid,
            guest_name: event.summary,
            checkin: event.checkin,
            checkout: event.checkout,
            nights: nights,
            status: 'confirmed'
          })
          .select()
          .single();

        if (bookingErr) {
          console.error('Error inserting booking:', bookingErr);
          continue;
        }

        // Get all confirmed bookings for date logic
        const { data: allBookings } = await supabase
          .from('bookings')
          .select('checkin, checkout, status')
          .eq('status', 'confirmed');

        const cleanResult = calculateCleaningDate(
          new Date(event.checkout),
          allBookings || [],
          []
        );

        const rateAmount = parseInt(cfg[`rate_${cleanResult.rateType}`] || cfg.rate_standard);

        await supabase.from('cleanings').insert({
          booking_id: booking.id,
          cleaning_date: toDateStr(cleanResult.date),
          rate_type: cleanResult.rateType,
          rate_amount: rateAmount,
          status: 'pending',
          is_new: true
        });

        addedBookings.push(booking);
        added++;
      }
    }

    // 5. Cancel removed bookings
    for (const existing_b of (existing || [])) {
      if (!incomingUids.has(existing_b.airbnb_uid) && existing_b.status === 'confirmed') {
        await supabase
          .from('bookings')
          .update({ status: 'cancelled', updated_at: new Date().toISOString() })
          .eq('id', existing_b.id);

        await supabase
          .from('cleanings')
          .update({ status: 'cancelled' })
          .eq('booking_id', existing_b.id);

        cancelledBookings.push(existing_b);
        cancelled++;
      }
    }

    // 6. Log sync
    await supabase.from('sync_log').insert({
      bookings_added: added,
      bookings_cancelled: cancelled,
      notes: `Added: ${added}, Cancelled: ${cancelled}`
    });

    // 7. Send email notifications if changes
    if (added > 0 || cancelled > 0) {
      try {
        await sendNotificationEmail(cfg, addedBookings, cancelledBookings);
      } catch (emailErr) {
        console.error('Email send error:', emailErr);
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ added, cancelled, message: `Sync complete. Added: ${added}, Cancelled: ${cancelled}` })
    };
  } catch (err) {
    console.error('Sync error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

function parseICal(text) {
  const events = [];
  const blocks = text.split('BEGIN:VEVENT');
  for (const block of blocks.slice(1)) {
    const get = (key) => {
      const match = block.match(new RegExp(`${key}[^:]*:(.+)`));
      return match ? match[1].trim() : null;
    };
    const uid = get('UID');
    const summary = get('SUMMARY');
    const dtstart = get('DTSTART');
    const dtend = get('DTEND');
    if (uid && dtstart && dtend) {
      events.push({
        uid,
        summary: summary || 'Airbnb guest',
        checkin: formatICalDate(dtstart),
        checkout: formatICalDate(dtend)
      });
    }
  }
  return events;
}

function formatICalDate(str) {
  const s = str.replace(/T.*/, '');
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

function fetchUrl(url) {
  const mod = url.startsWith('https') ? https : http;
  return new Promise((resolve, reject) => {
    mod.get(url, { headers: { 'User-Agent': '88Marina/1.0' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function toDateStr(date) {
  return date.toISOString().split('T')[0];
}

function calculateCleaningDate(checkoutDate, allBookings, bankHolidays) {
  const dow = checkoutDate.getDay();
  const isWeekend = dow === 0 || dow === 6;
  if (!isWeekend) return { date: checkoutDate, rateType: 'standard' };

  const sameDayCheckin = allBookings.some(b =>
    new Date(b.checkin).toDateString() === checkoutDate.toDateString() && b.status === 'confirmed'
  );
  if (sameDayCheckin) {
    const isBH = bankHolidays.includes(toDateStr(checkoutDate));
    return { date: checkoutDate, rateType: isBH ? 'bank_holiday' : 'weekend' };
  }

  const monday = new Date(checkoutDate);
  monday.setDate(monday.getDate() + (dow === 6 ? 2 : 1));

  const mondayCheckin = allBookings.some(b =>
    new Date(b.checkin).toDateString() === monday.toDateString() && b.status === 'confirmed'
  );

  const isBH = bankHolidays.includes(toDateStr(monday));
  return { date: monday, rateType: isBH ? 'bank_holiday' : 'standard', conflict: mondayCheckin };
}

async function sendNotificationEmail(cfg, added, cancelled) {
  const lines = [];
  if (added.length > 0) {
    lines.push(`New cleans added:\n${added.map(b => `- ${b.checkin} → ${b.checkout}`).join('\n')}`);
  }
  if (cancelled.length > 0) {
    lines.push(`Bookings cancelled:\n${cancelled.map(b => `- ${b.checkin} → ${b.checkout}`).join('\n')}`);
  }

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: 'noreply@yourdomain.com',
      to: cfg.cleaner_email,
      subject: '88 Marina — Cleaning schedule update',
      text: lines.join('\n\n')
    })
  });
}
