const nodemailer = require('nodemailer');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Gmail SMTP transporter
function getTransporter() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });
}

/**
 * Send an email via Gmail SMTP
 * @param {string} to - recipient email
 * @param {string} subject - email subject
 * @param {string} text - plain text body
 */
async function sendEmail(to, subject, text) {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    console.log('Gmail not configured, skipping email');
    return;
  }

  const transporter = getTransporter();
  await transporter.sendMail({
    from: `"88 Marina" <${process.env.GMAIL_USER}>`,
    to,
    subject,
    text,
  });
  console.log(`Email sent to ${to}: "${subject}"`);
}

// Netlify function handler (for direct API calls)
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' }, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const { type, data } = JSON.parse(event.body);

    const { data: settings } = await supabase.from('settings').select('key, value');
    const cfg = Object.fromEntries(settings.map(s => [s.key, s.value]));

    let subject, body;

    if (type === 'new_booking') {
      subject = '88 Marina — New clean scheduled';
      body = `Hi ${cfg.cleaner_name || 'Cleaner'},\n\nA new clean has been scheduled at ${cfg.property_name || '88 Marina'} for ${data.date}.\n\nPlease check the cleaning schedule for details:\nhttps://marinacleaning.netlify.app/\n\nThanks`;
    } else if (type === 'cancellation') {
      subject = '88 Marina — Clean cancelled';
      body = `Hi ${cfg.cleaner_name || 'Cleaner'},\n\nThe clean for ${data.guest || 'a guest'} (${data.date}) at ${cfg.property_name || '88 Marina'} has been cancelled.\n\nPlease check the cleaning schedule for details:\nhttps://marinacleaning.netlify.app/\n\nThanks`;
    } else if (type === 'reminder') {
      subject = '88 Marina — Clean tomorrow';
      body = `Hi ${cfg.cleaner_name || 'Cleaner'},\n\nReminder: you have a clean due tomorrow (${data.date}) for ${data.guest || 'a guest'} at ${cfg.property_name || '88 Marina'}.\n\nPlease check the cleaning schedule:\nhttps://marinacleaning.netlify.app/\n\nThanks`;
    } else {
      return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Unknown email type' }) };
    }

    const to = cfg.cleaner_email;
    if (!to) {
      return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'No cleaner email configured in settings' }) };
    }

    await sendEmail(to, subject, body);
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error('Email error:', err);
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: err.message }) };
  }
};

// Export sendEmail for use by other functions
exports.sendEmail = sendEmail;
