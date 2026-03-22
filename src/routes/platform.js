const admin = require('../firebaseAdmin');

function toIsoMaybe(value) {
  if (!value) return null;
  if (value && typeof value.toDate === 'function') return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return value;
}

function isPlatformOwner(req) {
  const claims = req.claims || {};
  return claims.role === 'platform_owner' || req.user?.uid === process.env.PLATFORM_OWNER_UID;
}

function requirePlatformOwner(req, res) {
  if (!isPlatformOwner(req)) {
    res.status(403).json({ error: 'No autorizado: se requieren permisos de platform_owner' });
    return false;
  }
  return true;
}

function formatAccountData(accountData, uid) {
  if (!accountData) return null;
  return {
    uid,
    ...accountData,
    createdAt: toIsoMaybe(accountData.createdAt),
    updatedAt: toIsoMaybe(accountData.updatedAt),
    paidUntil: toIsoMaybe(accountData.paidUntil),
    trialEndsAt: toIsoMaybe(accountData.trialEndsAt),
  };
}

function createPlatformRouter() {
  const router = require('express').Router();

  const accountsCol = () => admin.firestore().collection('platform').doc('accounts').collection('accounts');
  const plansCol = () => admin.firestore().collection('platform').doc('plans').collection('plans');
  const paymentsCol = () => admin.firestore().collection('platform').doc('payments').collection('payments');

  // POST /accounts/ensure (authenticated user)
  router.post('/accounts/ensure', async (req, res) => {
    try {
      const uid = req.user?.uid;
      const email = req.user?.email || '';
      if (!uid) return res.status(401).json({ error: 'No autorizado' });

      const accountRef = accountsCol().doc(uid);
      const accountDoc = await accountRef.get();
      if (accountDoc.exists) {
        return res.json(formatAccountData(accountDoc.data(), uid));
      }

      const now = admin.firestore.FieldValue.serverTimestamp();
      const FREE_STORAGE_BYTES = 5 * 1024 * 1024 * 1024;
      await accountRef.set({
        uid,
        email,
        status: 'active',
        planId: 'FREE_5GB',
        limits: { storageBytes: FREE_STORAGE_BYTES },
        enabledApps: {},
        paidUntil: null,
        trialEndsAt: null,
        createdAt: now,
        updatedAt: now,
        metadata: {},
      });

      const created = await accountRef.get();
      return res.json(formatAccountData(created.data(), uid));
    } catch (error) {
      console.error('Error in POST /platform/accounts/ensure', error);
      return res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  // Owner-only endpoints
  router.get('/accounts', async (req, res) => {
    try {
      if (!requirePlatformOwner(req, res)) return;
      const status = req.query.status;
      const limit = Math.min(parseInt(req.query.limit || '100', 10), 500);

      let query = accountsCol().limit(limit);
      if (typeof status === 'string' && status) query = query.where('status', '==', status);

      const snap = await query.get();
      const accounts = [];
      snap.forEach((doc) => accounts.push(doc.data()));
      return res.json({ accounts });
    } catch (error) {
      console.error('Error listing platform accounts', error);
      return res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  router.get('/accounts/:uid', async (req, res) => {
    try {
      if (!requirePlatformOwner(req, res)) return;
      const snap = await accountsCol().doc(req.params.uid).get();
      if (!snap.exists) return res.status(404).json({ error: 'Cuenta no encontrada' });
      return res.json(snap.data());
    } catch (error) {
      console.error('Error getting platform account', error);
      return res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  router.patch('/accounts/:uid', async (req, res) => {
    try {
      if (!requirePlatformOwner(req, res)) return;
      const accountRef = accountsCol().doc(req.params.uid);
      const accountSnap = await accountRef.get();
      if (!accountSnap.exists) return res.status(404).json({ error: 'Cuenta no encontrada' });

      const body = req.body || {};
      const { action } = body;
      const current = accountSnap.data() || {};
      const updates = {};

      switch (action) {
        case 'suspend':
          updates.status = 'suspended';
          break;
        case 'activate':
          updates.status = 'active';
          break;
        case 'change_plan':
          if (!body.planId) return res.status(400).json({ error: 'planId requerido' });
          {
            const planSnap = await plansCol().doc(body.planId).get();
            if (!planSnap.exists) return res.status(404).json({ error: 'Plan no encontrado' });
          }
          updates.planId = body.planId;
          break;
        case 'update_apps':
          if (!body.enabledApps || typeof body.enabledApps !== 'object') return res.status(400).json({ error: 'enabledApps requerido' });
          updates.enabledApps = body.enabledApps;
          break;
        case 'extend_paidUntil':
          if (!body.paidUntil) return res.status(400).json({ error: 'paidUntil requerido' });
          updates.paidUntil = new Date(body.paidUntil);
          break;
        case 'update_limits':
          if (!body.limits || typeof body.limits !== 'object') return res.status(400).json({ error: 'limits requerido' });
          updates.limits = body.limits;
          break;
        case 'update_notes':
          if (body.note === undefined) return res.status(400).json({ error: 'note requerido' });
          updates.metadata = { ...(current.metadata || {}), notes: body.note };
          break;
        default:
          return res.status(400).json({ error: 'Accion no valida' });
      }

      updates.updatedAt = new Date();
      await accountRef.set(updates, { merge: true });
      const updated = await accountRef.get();
      return res.json({ success: true, account: updated.data() });
    } catch (error) {
      console.error('Error patching platform account', error);
      return res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  router.get('/plans', async (req, res) => {
    try {
      if (!requirePlatformOwner(req, res)) return;
      const snap = await plansCol().get();
      const plans = [];
      snap.forEach((doc) => plans.push(doc.data()));
      return res.json({ plans });
    } catch (error) {
      console.error('Error listing platform plans', error);
      return res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  router.post('/plans', async (req, res) => {
    try {
      if (!requirePlatformOwner(req, res)) return;
      const body = req.body || {};
      const { planId, name, limits, apps, pricing } = body;
      if (!planId || !name || !limits || !apps || !pricing) {
        return res.status(400).json({ error: 'Campos requeridos: planId, name, limits, apps, pricing' });
      }

      const ref = plansCol().doc(planId);
      const exists = await ref.get();
      if (exists.exists) return res.status(409).json({ error: 'Plan ya existe' });

      const now = new Date();
      const newPlan = {
        planId,
        name,
        description: body.description || '',
        isActive: body.isActive !== false,
        limits,
        apps,
        pricing,
        features: Array.isArray(body.features) ? body.features : [],
        createdAt: now,
        updatedAt: now,
      };

      await ref.set(newPlan);
      return res.json({ success: true, plan: newPlan });
    } catch (error) {
      console.error('Error creating platform plan', error);
      return res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  router.get('/plans/:planId', async (req, res) => {
    try {
      if (!requirePlatformOwner(req, res)) return;
      const snap = await plansCol().doc(req.params.planId).get();
      if (!snap.exists) return res.status(404).json({ error: 'Plan no encontrado' });
      return res.json(snap.data());
    } catch (error) {
      console.error('Error getting plan', error);
      return res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  router.patch('/plans/:planId', async (req, res) => {
    try {
      if (!requirePlatformOwner(req, res)) return;
      const ref = plansCol().doc(req.params.planId);
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: 'Plan no encontrado' });

      const body = { ...(req.body || {}) };
      const action = body.action;
      let updates = { updatedAt: new Date() };

      if (action === 'deactivate') {
        updates.isActive = false;
      } else if (action === 'activate') {
        updates.isActive = true;
      } else {
        updates = { ...updates, ...body };
        delete updates.planId;
        delete updates.createdAt;
      }

      await ref.set(updates, { merge: true });
      const updated = await ref.get();
      return res.json({ success: true, plan: updated.data() });
    } catch (error) {
      console.error('Error updating plan', error);
      return res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  router.get('/payments', async (req, res) => {
    try {
      if (!requirePlatformOwner(req, res)) return;
      const uid = req.query.uid;
      const status = req.query.status;
      const limit = Math.min(parseInt(req.query.limit || '100', 10), 500);

      let query = paymentsCol().orderBy('createdAt', 'desc').limit(limit);
      if (typeof uid === 'string' && uid) query = query.where('uid', '==', uid);
      if (typeof status === 'string' && status) query = query.where('status', '==', status);

      const startAfter = req.query.startAfter;
      if (typeof startAfter === 'string' && startAfter) {
        const afterDoc = await paymentsCol().doc(startAfter).get();
        if (afterDoc.exists) query = query.startAfter(afterDoc);
      }

      const snap = await query.get();
      const payments = [];
      snap.forEach((doc) => payments.push(doc.data()));

      return res.json({
        payments,
        total: payments.length,
        hasMore: payments.length === limit,
      });
    } catch (error) {
      console.error('Error listing payments', error);
      return res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  router.post('/payments', async (req, res) => {
    try {
      if (!requirePlatformOwner(req, res)) return;
      const body = req.body || {};
      const { uid, planId, amount } = body;
      if (!uid || !planId || !amount) {
        return res.status(400).json({ error: 'Campos requeridos: uid, planId, amount' });
      }

      const paymentId = `payment_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      const now = new Date();
      const payment = {
        paymentId,
        uid,
        planId,
        amount,
        currency: body.currency || 'USD',
        interval: body.interval || 'monthly',
        status: body.status || 'completed',
        gateway: body.gateway || 'manual',
        paidUntil: body.paidUntil ? new Date(body.paidUntil) : null,
        createdAt: now,
        completedAt: body.status === 'completed' || !body.status ? now : null,
        metadata: body.metadata || {},
      };

      await paymentsCol().doc(paymentId).set(payment);
      return res.json({ success: true, payment });
    } catch (error) {
      console.error('Error creating payment', error);
      return res.status(500).json({ error: 'Error interno del servidor' });
    }
  });

  return router;
}

module.exports = createPlatformRouter();
