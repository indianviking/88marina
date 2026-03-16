const { createClient } = require('@supabase/supabase-js');
const { sendPush, shouldSend } = require('./notify');
const { sendEmail } = require('./send-email');

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

      // Toggle planner status
      case 'toggle_planner': {
        const added = body.added !== undefined ? body.added : true;
        await supabase
          .from('cleanings')
          .update({
            added_to_planner: added,
            planner_added_at: added ? new Date().toISOString() : null
          })
          .eq('id', body.cleaning_id);

        await supabase.from('audit_log').insert({
          action: added ? 'added_to_planner' : 'removed_from_planner',
          cleaning_id: body.cleaning_id,
          detail: added ? 'Cleaner added to planner' : 'Cleaner removed from planner'
        });

        // Notify admin when cleaner adds to planner (based on prefs)
        if (added) {
          const { data: cl } = await supabase.from('cleanings').select('cleaning_date, booking:bookings(guest_name)').eq('id', body.cleaning_id).single();
          const { data: stngs } = await supabase.from('settings').select('key, value');
          const cfg = Object.fromEntries((stngs || []).map(s => [s.key, s.value]));
          if (cl) {
            const d = new Date(cl.cleaning_date + 'T00:00:00');
            const dateStr = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
            const msg = `Cleaner confirmed ${dateStr} clean (${cl.booking?.guest_name || 'Guest'})`;
            if (shouldSend(cfg, 'notify_planner_admin', 'push', 'push'))
              await sendPush('admin', '✅ Added to Planner', msg, 'https://marinacleaning.netlify.app/admin');
            if (shouldSend(cfg, 'notify_planner_admin', 'email', 'push') && process.env.GMAIL_USER) {
              try { await sendEmail(process.env.GMAIL_USER, '88 Marina — Cleaner added to planner', msg + '\n\nhttps://marinacleaning.netlify.app/admin'); } catch (e) { console.error('Email error:', e.message); }
            }
          }
        }

        return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
      }

      // Mark complete
      case 'mark_complete': {
        // Server-side guard: only allow completion on or after the cleaning date
        const { data: cleanRec } = await supabase
          .from('cleanings').select('cleaning_date').eq('id', body.cleaning_id).single();
        if (cleanRec) {
          const today = new Date().toISOString().split('T')[0];
          if (cleanRec.cleaning_date > today) {
            return { statusCode: 400, headers, body: JSON.stringify({ error: 'Cannot complete a clean before its scheduled date' }) };
          }
        }

        await supabase
          .from('cleanings')
          .update({ status: 'complete', completed_at: new Date().toISOString() })
          .eq('id', body.cleaning_id);

        await supabase.from('audit_log').insert({
          action: 'marked_complete',
          cleaning_id: body.cleaning_id,
          detail: 'Cleaning marked complete'
        });

        // Notify admin when cleaner completes a clean (based on prefs)
        const { data: compCl } = await supabase.from('cleanings').select('cleaning_date, booking:bookings(guest_name)').eq('id', body.cleaning_id).single();
        const { data: compStngs } = await supabase.from('settings').select('key, value');
        const compCfg = Object.fromEntries((compStngs || []).map(s => [s.key, s.value]));
        if (compCl) {
          const d = new Date(compCl.cleaning_date + 'T00:00:00');
          const dateStr = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
          const msg = `Cleaner finished ${dateStr} clean (${compCl.booking?.guest_name || 'Guest'})`;
          if (shouldSend(compCfg, 'notify_complete_admin', 'push', 'push'))
            await sendPush('admin', '🏠 Clean Completed', msg, 'https://marinacleaning.netlify.app/admin');
          if (shouldSend(compCfg, 'notify_complete_admin', 'email', 'push') && process.env.GMAIL_USER) {
            try { await sendEmail(process.env.GMAIL_USER, '88 Marina — Clean completed', msg + '\n\nhttps://marinacleaning.netlify.app/admin'); } catch (e) { console.error('Email error:', e.message); }
          }
        }

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
            amount_pence: body.amount_pence || 0,
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
          detail: `Invoice ${body.invoice_number} submitted`
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
              text: `Invoice ${body.invoice_number} has been submitted.`
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
