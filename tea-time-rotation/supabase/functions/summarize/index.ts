/// <reference types="https://deno.land/x/service_worker@0.1.0/lib.d.ts" />

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface DrinkPrice {
  drink_type: string;
  sugar_level: string;
  price: number;
}

function resolvePrice(drink: string, sugar: string, prices: DrinkPrice[]): number {
  const exact = prices.find(p => p.drink_type === drink && p.sugar_level === sugar);
  if (exact) return exact.price;
  const drinkWild = prices.find(p => p.drink_type === drink && p.sugar_level === '*');
  if (drinkWild) return drinkWild.price;
  const wildSugar = prices.find(p => p.drink_type === '*' && p.sugar_level === sugar);
  if (wildSugar) return wildSugar.price;
  const wildWild = prices.find(p => p.drink_type === '*' && p.sugar_level === '*');
  if (wildWild) return wildWild.price;
  return 20;
}

Deno.serve(async (req) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    {
      global: {
        headers: { Authorization: req.headers.get('Authorization') ?? '' },
      },
    },
  );
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { session_id, confirm_assignee } = await req.json();

    const { data: orders, error: ordersError } = await supabase
    .from('orders')
    .select('*, users(*)')
    .eq('session_id', session_id)
    .eq('is_excused', false);

  if (ordersError) {
    return new Response(JSON.stringify({ error: ordersError.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }


  if (!orders || orders.length === 0) {
    return new Response(JSON.stringify({ error: 'No orders found for this session.' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 404,
    });
  }

  const users = orders.map(order => order.users);

  // Sort by total_cost_consumed/total_cost_sponsored ratio (desc) and then by last_assigned_at (asc)
  users.sort((a, b) => {
    const ratioA = a.total_cost_sponsored > 0 ? a.total_cost_consumed / a.total_cost_sponsored : (a.total_cost_consumed > 0 ? Infinity : 0);
    const ratioB = b.total_cost_sponsored > 0 ? b.total_cost_consumed / b.total_cost_sponsored : (b.total_cost_consumed > 0 ? Infinity : 0);

    if (ratioA !== ratioB) {
      return ratioB - ratioA; // Sort descending by ratio
    }

    // Tie-breaker: earliest last_assigned_at
    if (a.last_assigned_at === null) return -1;
    if (b.last_assigned_at === null) return 1;
    return new Date(a.last_assigned_at).getTime() - new Date(b.last_assigned_at).getTime();
  });

  // Phase 1: Return top 2 candidates for admin selection
  if (!confirm_assignee) {
    const topCandidates = users.slice(0, Math.min(2, users.length));
    return new Response(JSON.stringify({
      requiresConfirmation: true,
      candidates: topCandidates
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  }

  // Phase 2: Commit to DB with confirmed assignee
  const assignee = users.find(u => u.id === confirm_assignee);

  if (!assignee) {
    return new Response(JSON.stringify({ error: 'Invalid assignee selected.' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }

  // Resolve summarizer from auth header
  let summarizerUserId: string | null = null;
  const { data: authUserResult } = await supabase.auth.getUser();
  const authUserId = authUserResult?.user?.id ?? null;
  if (authUserId) {
    const { data: summarizer } = await supabase
      .from('users')
      .select('id, name')
      .eq('auth_user_id', authUserId)
      .single();
    summarizerUserId = summarizer?.id ?? null;
  }

  // Fetch guest orders for this session
  const { data: guestOrdersData } = await supabase
    .from('guest_orders')
    .select('*')
    .eq('session_id', session_id);
  const allGuestOrders = guestOrdersData || [];

  // Atomic update: only succeeds if status is still 'active'
  const { data: updatedSession, error: sessionUpdateError } = await supabase
    .from('sessions')
    .update({
      status: 'completed',
      ended_at: new Date().toISOString(),
      assignee_name: assignee.name,
      total_drinks_in_session: orders.length + allGuestOrders.length,
      summarized_by: summarizerUserId,
    })
    .eq('id', session_id)
    .eq('status', 'active')  // CRITICAL: Only update if still active
    .select();

  // Check if the update succeeded
  if (!updatedSession || updatedSession.length === 0) {
    return new Response(
      JSON.stringify({
        error: 'Session already summarized',
        message: 'This session has already been completed by another admin.'
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 409,
      }
    );
  }

  if (sessionUpdateError) {
    return new Response(
      JSON.stringify({ error: sessionUpdateError.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }

  // Fetch drink prices for cost resolution
  const { data: drinkPricesData } = await supabase.from('drink_prices').select('*');
  const prices: DrinkPrice[] = drinkPricesData || [];

  // Update last order details for each user
  for (const order of orders) {
    if (order.user_id) {
      const updateData = {
        last_ordered_drink: order.drink_type,
        last_sugar_level: order.sugar_level,
      };

      const { error } = await supabase
        .from('users')
        .update(updateData)
        .eq('id', order.user_id);

      if (error) {
        console.error(`Error updating user ${order.user_id}:`, error);
      }
    }
  }

  // Increment drink_count and total_cost_consumed for all participating users
  for (const order of orders) {
    if (order.user_id) {
      await supabase.rpc('increment_drink_count', { user_id: order.user_id });
      const price = resolvePrice(order.drink_type, order.sugar_level, prices);
      await supabase.rpc('increment_total_cost_consumed', { p_user_id: order.user_id, p_amount: price });
    }
  }

  // Increment drink_count and total_cost_consumed for guest orders (billed to sponsoring user)
  for (const guestOrder of allGuestOrders) {
    await supabase.rpc('increment_drink_count', { user_id: guestOrder.billed_to });
    const price = resolvePrice(guestOrder.drink_type, guestOrder.sugar_level, prices);
    await supabase.rpc('increment_total_cost_consumed', { p_user_id: guestOrder.billed_to, p_amount: price });
  }

  await supabase
    .from('users')
    .update({ last_assigned_at: new Date().toISOString() })
    .eq('id', assignee.id);

  const totalDrinks = orders.length + allGuestOrders.length;
  await supabase.rpc('increment_total_drinks_bought', { p_user_id: assignee.id, p_amount: totalDrinks });

  // Increment total_cost_sponsored for assignee (total session cost including guest drinks)
  const regularCost = orders.reduce((sum, order) => sum + resolvePrice(order.drink_type, order.sugar_level, prices), 0);
  const guestCost = allGuestOrders.reduce((sum, go) => sum + resolvePrice(go.drink_type, go.sugar_level, prices), 0);
  const totalSessionCost = regularCost + guestCost;
  await supabase.rpc('increment_total_cost_sponsored', { p_user_id: assignee.id, p_amount: totalSessionCost });

  return new Response(JSON.stringify({ assignee, committed: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status: 200,
  });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
