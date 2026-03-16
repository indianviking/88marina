const { createClient } = require('@supabase/supabase-js');
const { sendPush } = require('./notify');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Runs daily — sends reminder to cleaner for cleans due tomorrow
exports.handler = async function () {
  try {
    // Calculate tomorrow's date
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

    for (const c of cleans) {
      const guest = c.booking?.guest_name || 'Guest';
      const d = new Date(c.cleaning_date + 'T00:00:00');
      const dateStr = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
      await sendPush(
        'cleaner',
        '🔔 Clean Tomorrow',
        `Reminder: ${guest} clean is due ${dateStr}`,
        'https://marinacleaning.netlify.app/'
      );
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
