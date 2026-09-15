const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { items, customer } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: 'Carrito vacío' });
      return;
    }

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const codes = items.map((i) => i.code);
    const { data: products, error } = await supabase
      .from('products')
      .select('code, name, color, talla, price, stock_local')
      .in('code', codes);

    if (error) throw error;

    const orderItems = [];
    let total = 0;

    for (const it of items) {
      const p = products.find((x) => x.code === it.code);
      if (!p) {
        res.status(400).json({ error: `Producto no encontrado: ${it.code}` });
        return;
      }
      const qty = Math.max(1, parseInt(it.qty, 10) || 1);
      if (p.stock_local < qty) {
        res.status(400).json({ error: `Sin existencias suficientes de ${p.name}` });
        return;
      }
      const label = [p.color, p.talla].filter(Boolean).join(' ');
      orderItems.push({
        code: p.code,
        name: label ? `${p.name} (${label})` : p.name,
        price: Number(p.price),
        qty,
      });
      total += Number(p.price) * qty;
    }

    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .insert({
        items: orderItems,
        total,
        status: 'pending',
        customer_name: customer && customer.name ? customer.name : '',
        customer_email: customer && customer.email ? customer.email : '',
        customer_phone: customer && customer.phone ? customer.phone : '',
      })
      .select()
      .single();

    if (orderErr) throw orderErr;

    const siteUrl = `https://${req.headers.host}`;

    const mpRes = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        items: orderItems.map((i) => ({
          title: i.name,
          quantity: i.qty,
          unit_price: i.price,
          currency_id: 'MXN',
        })),
        external_reference: order.id,
        notification_url: `${siteUrl}/api/webhook`,
        back_urls: {
          success: `${siteUrl}/tienda.html?estado=exito`,
          failure: `${siteUrl}/tienda.html?estado=fallo`,
          pending: `${siteUrl}/tienda.html?estado=pendiente`,
        },
        auto_return: 'approved',
      }),
    });

    const mpData = await mpRes.json();
    if (!mpRes.ok) {
      throw new Error(mpData.message || 'Error creando la preferencia de pago');
    }

    await supabase.from('orders').update({ mp_preference_id: mpData.id }).eq('id', order.id);

    var checkoutUrl = mpData.sandbox_init_point || mpData.init_point;
    if(!checkoutUrl){
      throw new Error('Mercado Pago no regresó un link de pago válido');
    }

    res.status(200).json({ checkoutUrl: checkoutUrl });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error del servidor: ' + err.message });
  }
};

