const { createClient } = require('@supabase/supabase-js');
const https = require('https');

// --- Inline push notification helper ---
async function sendPush(role, heading, message, url) {
  const APP_ID = process.env.ONESIGNAL_APP_ID;
  const API_KEY = process.env.ONESIGNAL_API_KEY;
  if (!APP_ID || !API_KEY) return;
  const payload = JSON.stringify({
    app_id: APP_ID, headings: { en: heading }, contents: { en: message },
    filters: [{ field: 'tag', key: 'role', relation: '=', value: role }],
    ...(url ? { url } : {})
  });
  return new Promise(resolve => {
    const req = https.request({
      hostname: 'api.onesignal.com', path: '/notifications', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Key ${API_KEY}`, 'Content-Length': Buffer.byteLength(payload) }
    }, res => { let b = ''; res.on('data', c => b += c); res.on('end', () => resolve()); });
    req.on('error', () => resolve());
    req.write(payload); req.end();
  });
}

function shouldSend(cfg, key, method, defaultVal) {
  const pref = cfg[key] || defaultVal;
  if (pref === 'off') return false;
  if (pref === 'both') return true;
  return pref === method;
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Runs daily at 8am — sends reminder to cleaner for cleans due tomorrow
exports.handler = async function () {
  try {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    const { data: cleans } = await supabase
      .from('cleanings')
      .select('id, cleaning_date, booking:bookings(guest_name, checkin, checkout)')
      .eq('cleaning_date', tomorrowStr)
      .eq('status', 'pending');

    if (!cleans || cleans.length === 0) {
      return { statusCode: 200, body: JSON.stringify({ message: 'No cleans due tomorrow' }) };
    }

    // Get cleaner email from settings
    const { data: settings } = await supabase.from('settings').select('key, value');
    const cfg = Object.fromEntries((settings || []).map(s => [s.key, s.value]));

    for (const c of cleans) {
      const guest = c.booking?.guest_name || 'Guest';
      const d = new Date(c.cleaning_date + 'T00:00:00');
      const dateStr = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });

      // Push notification (based on prefs)
      const msg = `Reminder: ${guest} clean is due ${dateStr}`;
      if (shouldSend(cfg, 'notify_reminder_cleaner', 'push', 'both'))
        await sendPush('cleaner', '🔔 Clean Tomorrow', msg, 'https://marinacleaning.netlify.app/');

    }

    return {
      statusCode: 200,
      body: JSON.stringify({ message: `Sent ${cleans.length} reminder(s)` })
    };
  } catch (err) {
    console.error('Reminder error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
