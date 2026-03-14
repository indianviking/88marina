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

    // 4. Add new bookings
    for (const event of events) {
      if (!existingMap[event.uid]) {
        const { data: booking, error: bookingErr } = await supabase
          .from('bookings')
          .insert({
            airbnb_uid: event.uid,
            guest_name: event.summary,
            checkin: event.checkin,
            checkout: event.checkout,
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
