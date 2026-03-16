const { createClient } = require('@supabase/supabase-js');
const { sendPush } = require('./notify');
const { sendEmail } = require('./send-email');

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

      // Push notification
      await sendPush(
        'cleaner',
        '🔔 Clean Tomorrow',
        `Reminder: ${guest} clean is due ${dateStr}`,
        'https://marinacleaning.netlify.app/'
      );

      // Email
      if (cfg.cleaner_email) {
        try {
          await sendEmail(cfg.cleaner_email, '88 Marina — Clean tomorrow',
            `Hi ${cfg.cleaner_name || 'Cleaner'},\n\nReminder: you have a clean due tomorrow (${dateStr}) for ${guest} at ${cfg.property_name || '88 Marina'}.\n\nCheck the schedule: https://marinacleaning.netlify.app/\n\nThanks`);
        } catch (e) { console.error('Reminder email error:', e.message); }
      }
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
