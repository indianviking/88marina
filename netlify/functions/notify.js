// OneSignal push notification helper
// Used by sync-ical, cleaner-api, and send-reminders

const ONESIGNAL_APP_ID = process.env.ONESIGNAL_APP_ID;
const ONESIGNAL_API_KEY = process.env.ONESIGNAL_API_KEY;

/**
 * Send a push notification via OneSignal
 * @param {string} role - 'cleaner' or 'admin'
 * @param {string} heading - notification title
 * @param {string} message - notification body
 * @param {string} [url] - optional URL to open on click
 */
async function sendPush(role, heading, message, url) {
  if (!ONESIGNAL_APP_ID || !ONESIGNAL_API_KEY) {
    console.log('OneSignal not configured, skipping push notification');
    return;
  }

  const payload = {
    app_id: ONESIGNAL_APP_ID,
    headings: { en: heading },
    contents: { en: message },
    filters: [{ field: 'tag', key: 'role', relation: '=', value: role }],
  };

  if (url) {
    payload.url = url;
  }

  try {
    const res = await fetch('https://api.onesignal.com/notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Key ${ONESIGNAL_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (data.errors) {
      console.error('OneSignal error:', data.errors);
    } else {
      console.log(`Push sent to ${role}: "${heading}" — recipients: ${data.recipients || 0}`);
    }
  } catch (err) {
    console.error('Failed to send push:', err.message);
  }
}

module.exports = { sendPush };
