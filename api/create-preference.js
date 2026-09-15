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

    // Validar cada producto contra la base de datos real —
    // nunca se confía en el precio o stock que mande el navegador.
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
      if (p.stock_local 
