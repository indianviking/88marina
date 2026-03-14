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
      // Mark new cleanings as seen
      case 'mark_seen': {
        const ids = body.cleaning_ids;
        if (ids && ids.length > 0) {
          await supabase
            .from('cleanings')
            .update({ is_new: false })
            .in('id', ids);
        }
        return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
      }

      // Add to planner
      case 'toggle_planner': {
        await supabase
          .from('cleanings')
          .update({ added_to_planner: true, planner_added_at: new Date().toISOString() })
          .eq('id', body.cleaning_id);

        await supabase.from('audit_log').insert({
          action: 'added_to_planner',
          cleaning_id: body.cleaning_id,
          detail: 'Cleaner added to planner'
        });
        return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
      }

      // Mark complete
      case 'mark_complete': {
        await supabase
          .from('cleanings')
          .update({ status: 'complete', completed_at: new Date().toISOString() })
          .eq('id', body.cleaning_id);

        await supabase.from('audit_log').insert({
          action: 'marked_complete',
          cleaning_id: body.cleaning_id,
          detail: 'Cleaning marked complete'
        });
        return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
      }

      // Acknowledge cancellation
      case 'acknowledge_cancellation': {
        await supabase
          .from('cleanings')
          .update({ cancellation_acknowledged: true })
          .eq('id', body.cleaning_id);

        await supabase.from('audit_log').insert({
          action: 'cancellation_acknowledged',
          cleaning_id: body.cleaning_id,
          detail: 'Cancellation acknowledged by cleaner'
        });
        return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
      }

      // Save checklist data
      case 'save_checklist': {
        await supabase
          .from('cleanings')
          .update({ checklist_data: body.checklist_data })
          .eq('id', body.cleaning_id);
        return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
      }

      // Save damage notes
      case 'save_damage_notes': {
        await supabase
          .from('cleanings')
          .update({ damage_notes: body.damage_notes || null })
          .eq('id', body.cleaning_id);
        return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
      }

      // Submit invoice
      case 'submit_invoice': {
        const { data: invoice, error } = await supabase
          .from('invoices')
          .insert({
            invoice_number: body.invoice_number,
            amount_pence: body.amount_pence,
            file_url: body.file_url || null,
            file_name: body.file_name || null
          })
          .select()
          .single();

        if (error) throw error;

        // Link cleanings to invoice
        if (body.cleaning_ids && body.cleaning_ids.length > 0) {
          await supabase
            .from('cleanings')
            .update({ invoice_id: invoice.id })
            .in('id', body.cleaning_ids);
        }

        await supabase.from('audit_log').insert({
          action: 'invoice_submitted',
          invoice_id: invoice.id,
          detail: `Invoice ${body.invoice_number} submitted for £${(body.amount_pence / 100).toFixed(2)}`
        });

        // Send email notification to owner
        try {
          const { data: settingsData } = await supabase.from('settings').select('key, value');
          const cfg = Object.fromEntries((settingsData || []).map(s => [s.key, s.value]));

          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              from: 'noreply@yourdomain.com',
              to: cfg.cleaner_email || 'owner@example.com',
              subject: '88 Marina — Invoice submitted',
              text: `Invoice ${body.invoice_number} has been submitted for £${(body.amount_pence / 100).toFixed(2)}.`
            })
          });
        } catch (e) {
          console.error('Email notification failed:', e);
        }

        return { statusCode: 200, headers, body: JSON.stringify({ success: true, invoice }) };
      }

      default:
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action: ' + action }) };
    }
  } catch (err) {
    console.error('Cleaner API error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
