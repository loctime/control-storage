const express = require('express');
const Stripe = require('stripe');
const { findPlanById, getPlanPrice } = require('../services/plans');

const router = express.Router();

router.post('/checkout', async (req, res) => {
  try {
    if (!process.env.STRIPE_SECRET_KEY || !process.env.NEXT_PUBLIC_BASE_URL) {
      return res.status(500).json({ error: 'Stripe no configurado' });
    }

    const { planId, interval } = req.body || {};
    if (!planId) return res.status(400).json({ error: 'planId requerido' });
    if (interval && interval !== 'monthly' && interval !== 'yearly') {
      return res.status(400).json({ error: 'interval invalido' });
    }

    const plan = findPlanById(planId);
    if (!plan) return res.status(400).json({ error: 'Plan invalido' });

    const billingInterval = interval || 'monthly';
    const unitAmount = Math.round(getPlanPrice(plan, billingInterval) * 100);

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `Plan ${plan.name} (${billingInterval === 'monthly' ? 'Mensual' : 'Anual'})`,
            },
            unit_amount: unitAmount,
            recurring: {
              interval: billingInterval === 'monthly' ? 'month' : 'year',
            },
          },
          quantity: 1,
        },
      ],
      success_url: `${process.env.NEXT_PUBLIC_BASE_URL}/settings?checkout=success`,
      cancel_url: `${process.env.NEXT_PUBLIC_BASE_URL}/settings?checkout=cancel`,
      metadata: {
        userId: req.user?.uid || '',
        planId: plan.planId,
        interval: billingInterval,
      },
    });

    return res.json({ url: session.url });
  } catch (error) {
    console.error('Error creating checkout session', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;
