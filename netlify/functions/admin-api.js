const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const body = JSON.parse(event.body);
    const { action } = body;

    switch (action) {
      // ---- Settings ----
      case 'save_settings': {
        // body.settings = { key: value, ... }
        const settingsObj = body.settings || {};
        for (const [key, value] of Object.entries(settingsObj)) {
          await supabase
            .from('settings')
            .update({ value: String(value), updated_at: new Date().toISOString() })
            .eq('key', key);
        }
        return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
      }

      // ---- Checklist ----
      case 'save_checklist': {
        // body.items = [{ id?, label, sort_order }]
        const items = body.items || [];
        for (const item of items) {
          if (item.id) {
            await supabase
              .from('checklist_items')
              .update({ label: item.label, sort_order: item.sort_order })
              .eq('id', item.id);
          } else if (item.label && item.label.trim()) {
            await supabase
              .from('checklist_items')
              .insert({ label: item.label.trim(), sort_order: item.sort_order, active: true });
          }
        }
        return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
      }

      case 'remove_checklist_item': {
        await supabase
          .from('checklist_items')
          .update({ active: false })
          .eq('id', body.id);
        return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
      }

      // ---- Invoice ----
      case 'mark_invoice_paid': {
        await supabase
          .from('invoices')
          .update({ status: 'paid', paid_at: new Date().toISOString() })
          .eq('id', body.invoice_id);

        await supabase.from('audit_log').insert({
          action: 'invoice_paid',
          invoice_id: body.invoice_id,
          detail: 'Invoice marked as paid'
        });
        return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
      }

      // ---- Manual sync trigger ----
      case 'trigger_sync': {
        const syncModule = require('./sync-ical');
        const result = await syncModule.handler({});
        return { statusCode: 200, headers, body: result.body };
      }

      // ---- WhatsApp sent tracking ----
      case 'record_whatsapp': {
        await supabase
          .from('settings')
          .update({ value: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq('key', 'last_whatsapp_sent');
        return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
      }

      default:
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action: ' + action }) };
    }
  } catch (err) {
    console.error('Admin API error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
