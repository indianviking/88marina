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

      // ---- Manual add clean ----
      case 'add_manual_clean': {
        // body: { cleaning_date, rate_type, rate_amount, guest_name, checkin, checkout }
        // Create a manual booking first
        const { data: booking, error: bErr } = await supabase
          .from('bookings')
          .insert({
            airbnb_uid: 'manual-' + Date.now(),
            guest_name: body.guest_name || 'Manual booking',
            checkin: body.checkin,
            checkout: body.checkout,
            status: 'confirmed'
          })
          .select()
          .single();
        if (bErr) throw bErr;

        const { data: cleaning, error: cErr } = await supabase
          .from('cleanings')
          .insert({
            booking_id: booking.id,
            cleaning_date: body.cleaning_date,
            rate_type: body.rate_type || 'standard',
            rate_amount: body.rate_amount || 0,
            status: 'pending',
            is_new: true
          })
          .select()
          .single();
        if (cErr) throw cErr;

        await supabase.from('audit_log').insert({
          action: 'manual_clean_added',
          cleaning_id: cleaning.id,
          detail: `Manual clean added for ${body.cleaning_date}`
        });

        return { statusCode: 200, headers, body: JSON.stringify({ success: true, cleaning }) };
      }

      // ---- Remove clean ----
      case 'remove_clean': {
        // body: { cleaning_id }
        const { data: cleanData } = await supabase
          .from('cleanings')
          .select('booking_id')
          .eq('id', body.cleaning_id)
          .single();

        await supabase
          .from('cleanings')
          .delete()
          .eq('id', body.cleaning_id);

        // Also remove the booking if it was manual
        if (cleanData && cleanData.booking_id) {
          const { data: bookingData } = await supabase
            .from('bookings')
            .select('airbnb_uid')
            .eq('id', cleanData.booking_id)
            .single();

          if (bookingData && bookingData.airbnb_uid && bookingData.airbnb_uid.startsWith('manual-')) {
            await supabase.from('bookings').delete().eq('id', cleanData.booking_id);
          }
        }

        await supabase.from('audit_log').insert({
          action: 'clean_removed',
          detail: `Clean ${body.cleaning_id} removed`
        });

        return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
      }

      // ---- Cleanup orphan "Not available" cleanings ----
      case 'cleanup_blocks': {
        const { data: blockBookings } = await supabase
          .from('bookings')
          .select('id, guest_name, checkin, checkout, status')
          .eq('status', 'confirmed');

        let cleaned = 0;
        for (const b of (blockBookings || [])) {
          const name = (b.guest_name || '').toLowerCase();
          if (name.includes('not available') || name.includes('unavailable')) {
            // Remove any cleanings linked to this booking
            await supabase.from('cleanings').delete().eq('booking_id', b.id);
            // Delete 1-night blocks, convert 2+ nights to block status
            const ci = new Date(b.checkin + 'T00:00:00');
            const co = new Date(b.checkout + 'T00:00:00');
            const nights = Math.round((co - ci) / (1000 * 60 * 60 * 24));
            if (nights >= 2) {
              await supabase.from('bookings').update({ status: 'block', nights }).eq('id', b.id);
            } else {
              await supabase.from('bookings').delete().eq('id', b.id);
            }
            cleaned++;
          }
        }
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, cleaned }) };
      }

      // ---- Bulk add historic cleans ----
      case 'bulk_add_cleans': {
        // body.cleans = [{ guest_name, checkin, checkout, cleaning_date, rate_type, rate_amount, completed }]
        const results = [];
        for (const item of (body.cleans || [])) {
          // Check if a booking already exists for this checkin/checkout/guest
          let bookingId;
          const { data: existingBooking } = await supabase
            .from('bookings')
            .select('id')
            .eq('guest_name', item.guest_name)
            .eq('checkin', item.checkin)
            .eq('checkout', item.checkout)
            .single();

          if (existingBooking) {
            bookingId = existingBooking.id;
          } else {
            const { data: newBooking, error: bErr } = await supabase
              .from('bookings')
              .insert({
                airbnb_uid: 'manual-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
                guest_name: item.guest_name,
                checkin: item.checkin,
                checkout: item.checkout,
                status: 'confirmed'
              })
              .select()
              .single();
            if (bErr) { results.push({ error: bErr.message, item }); continue; }
            bookingId = newBooking.id;
          }

          const { data: cleaning, error: cErr } = await supabase
            .from('cleanings')
            .insert({
              booking_id: bookingId,
              cleaning_date: item.cleaning_date,
              rate_type: item.rate_type || 'standard',
              rate_amount: item.rate_amount || 80,
              status: item.completed ? 'complete' : 'pending',
              completed_at: item.completed ? item.cleaning_date + 'T12:00:00Z' : null,
              is_new: false
            })
            .select()
            .single();
          if (cErr) { results.push({ error: cErr.message, item }); continue; }
          results.push({ success: true, cleaning_id: cleaning.id, guest: item.guest_name });
        }
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, results }) };
      }

      // ---- Restore cancelled manual bookings ----
      case 'restore_manual_bookings': {
        // Find all cancelled manual bookings
        const { data: cancelledManual } = await supabase
          .from('bookings')
          .select('id, airbnb_uid, guest_name, checkin, checkout')
          .eq('status', 'cancelled')
          .like('airbnb_uid', 'manual-%');

        const restored = [];
        for (const b of (cancelledManual || [])) {
          const newStatus = body.statuses && body.statuses[b.id] ? body.statuses[b.id] : 'confirmed';
          await supabase.from('bookings').update({ status: newStatus }).eq('id', b.id);

          // Also restore associated cleanings
          const cleanStatus = newStatus === 'confirmed' ? 'pending' : 'complete';
          const cleanUpdate = { status: cleanStatus };
          if (cleanStatus === 'complete') cleanUpdate.completed_at = cleanUpdate.completed_at || new Date().toISOString();
          await supabase.from('cleanings').update(cleanUpdate).eq('booking_id', b.id);

          restored.push({ id: b.id, guest: b.guest_name, status: newStatus });
        }
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, restored }) };
      }

      // ---- Fix past manual cleanings to complete ----
      case 'fix_past_manual_cleans': {
        const today = new Date().toISOString().split('T')[0];
        const { data: pastCleans } = await supabase
          .from('cleanings')
          .select('id, cleaning_date, booking:bookings(airbnb_uid)')
          .eq('status', 'pending')
          .lt('cleaning_date', today);

        const fixed = [];
        for (const c of (pastCleans || [])) {
          if (c.booking && c.booking.airbnb_uid && c.booking.airbnb_uid.startsWith('manual-')) {
            await supabase.from('cleanings').update({
              status: 'complete',
              completed_at: c.cleaning_date + 'T12:00:00Z'
            }).eq('id', c.id);
            fixed.push({ id: c.id, date: c.cleaning_date });
          }
        }
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, fixed }) };
      }

      // ---- Update cleaning date ----
      case 'update_cleaning_date': {
        const updates = { cleaning_date: body.cleaning_date };
        if (body.rate_type) updates.rate_type = body.rate_type;
        if (body.rate_amount !== undefined) updates.rate_amount = body.rate_amount;
        const { error } = await supabase
          .from('cleanings')
          .update(updates)
          .eq('id', body.cleaning_id);
        if (error) throw error;
        return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
      }

      // ---- Reset cleaning to pending ----
      case 'reset_to_pending': {
        const { error } = await supabase
          .from('cleanings')
          .update({ status: 'pending', completed_at: null })
          .eq('id', body.cleaning_id);
        if (error) throw error;
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
