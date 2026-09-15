const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  try {
    const paymentId =
      req.query['data.id'] || (req.body && req.body.data && req.body.data.id) || req.query.id;
    const topic = req.query.type || req.query.topic || (req.body && req.body.type);

    if (!paymentId || (topic && topic !== 'payment')) {
      res.status(200).send('ok');
      return;
    }

    // Nunca se confía en el contenido del aviso — se confirma directo con Mercado Pago.
    const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` },
    });
    const payment = await mpRes.json();

    if (!mpRes.ok) {
      res.status(200).send('ok');
      return;
    }

    const orderId = payment.external_reference;
    if (!orderId) {
      res.status(200).send('ok');
      return;
    }

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const { data: order } = await supabase.from('orders').select('*').eq('id', orderId).single();
    if (!order || order.status === 'paid') {
      res.status(200).send('ok');
      return;
    }

    if (payment.status === 'approved') {
      for (const item of order.items) {
        await supabase.rpc('decrement_stock_local', { p_code: item.code, p_qty: item.qty });
      }
      await supabase
        .from('orders')
        .update({ status: 'paid', mp_payment_id: String(paymentId) })
        .eq('id', orderId);
    } else {
      await supabase
        .from('orders')
        .update({ status: payment.status, mp_payment_id: String(paymentId) })
        .eq('id', orderId);
    }

    res.status(200).send('ok');
  } catch (err) {
    console.error(err);
    // Siempre 200: si le devolvemos error, Mercado Pago reintenta sin parar.
    res.status(200).send('ok');
  }
};
