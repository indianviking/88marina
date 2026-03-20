// OneSignal push notification helper
// Used by sync-ical, cleaner-api, and send-reminders

const https = require('https');

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

  return new Promise((resolve) => {
    const data = JSON.stringify(payload);
    const req = https.request({
      hostname: 'api.onesignal.com',
      path: '/notifications',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Key ${ONESIGNAL_API_KEY}`,
        'Content-Length': Buffer.byteLength(data)
      }
    }, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const result = JSON.parse(body);
          if (result.errors) {
            console.error('OneSignal error:', result.errors);
          } else {
            console.log(`Push sent to ${role}: "${heading}" — recipients: ${result.recipients || 0}`);
          }
        } catch (e) {
          console.error('OneSignal parse error:', body);
        }
        resolve();
      });
    });
    req.on('error', err => {
      console.error('Failed to send push:', err.message);
      resolve(); // don't reject, notifications are non-critical
    });
    req.write(data);
    req.end();
  });
}

/**
 * Check if a notification should be sent based on settings
 * @param {object} cfg - settings object
 * @param {string} settingKey - e.g. 'notify_new_clean_cleaner'
 * @param {string} method - 'push' or 'email'
 * @param {string} defaultVal - default if setting not found
 */
function shouldSend(cfg, settingKey, method, defaultVal) {
  const pref = cfg[settingKey] || defaultVal;
  if (pref === 'off') return false;
  if (pref === 'both') return true;
  return pref === method;
}

module.exports = { sendPush, shouldSend };
