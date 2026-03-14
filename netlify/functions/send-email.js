const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const { type, data } = JSON.parse(event.body);

    // Get settings for templates
    const { data: settings } = await supabase
      .from('settings')
      .select('key, value');
    const cfg = Object.fromEntries(settings.map(s => [s.key, s.value]));

    let subject, body;

    if (type === 'new_booking') {
      subject = `88 Marina — New clean scheduled`;
      body = cfg.email_template_new
        .replace('{cleaner_name}', cfg.cleaner_name)
        .replace('{property}', cfg.property_name)
        .replace('{date}', data.date);
    } else if (type === 'cancellation') {
      subject = `88 Marina — Booking cancelled`;
      body = cfg.email_template_cancel
        .replace('{cleaner_name}', cfg.cleaner_name)
        .replace('{property}', cfg.property_name)
        .replace('{date}', data.date);
    } else if (type === 'invoice_submitted') {
      subject = `88 Marina — Invoice submitted`;
      body = `Invoice ${data.invoice_number} has been submitted for £${(data.amount_pence / 100).toFixed(2)}.\n\nView it in your admin dashboard.`;
    } else {
      return { statusCode: 400, body: JSON.stringify({ error: 'Unknown email type' }) };
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'noreply@yourdomain.com',
        to: type === 'invoice_submitted' ? cfg.cleaner_email : cfg.cleaner_email,
        subject,
        text: body
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('Resend error:', errText);
      return { statusCode: 500, body: JSON.stringify({ error: 'Email send failed' }) };
    }

    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (err) {
    console.error('Email error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
