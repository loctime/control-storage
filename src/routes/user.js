const express = require('express');
const router = express.Router();
const admin = require('../firebaseAdmin');
const { findPlanById } = require('../services/plans');

function isValidBillingInterval(interval) {
  return interval === 'monthly' || interval === 'yearly';
}

// GET /user/settings
router.get('/settings', async (req, res) => {
  try {
    const { uid } = req.user;
    const docRef = admin.firestore().collection('userSettings').doc(uid);
    const snap = await docRef.get();
    const data = snap.exists ? snap.data() : {};

    return res.json({
      billingInterval: data?.billingInterval || null,
    });
  } catch (error) {
    console.error('Error getting user settings:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST /user/settings
router.post('/settings', async (req, res) => {
  try {
    const { uid } = req.user;
    const { billingInterval } = req.body || {};

    if (!isValidBillingInterval(billingInterval)) {
      return res.status(400).json({ error: 'billingInterval invalido' });
    }

    const docRef = admin.firestore().collection('userSettings').doc(uid);
    await docRef.set({ billingInterval, updatedAt: new Date() }, { merge: true });

    return res.json({ success: true });
  } catch (error) {
    console.error('Error saving user settings:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /user/taskbar
router.get('/taskbar', async (req, res) => {
  try {
    const { uid } = req.user;
    const docRef = admin.firestore().collection('userSettings').doc(uid);
    const snap = await docRef.get();
    const data = snap.exists ? snap.data() : {};
    const items = Array.isArray(data?.taskbarItems) ? data.taskbarItems : [];

    return res.json({ items });
  } catch (error) {
    console.error('Error getting taskbar items:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST /user/taskbar
router.post('/taskbar', async (req, res) => {
  try {
    const { uid } = req.user;
    const { items } = req.body || {};

    if (!Array.isArray(items)) {
      return res.status(400).json({ error: 'items debe ser un arreglo' });
    }

    const normalized = items
      .filter((it) => it && typeof it === 'object')
      .map((it) => ({
        id: String(it.id || ''),
        name: String(it.name || ''),
        icon: typeof it.icon === 'string' ? it.icon : 'Folder',
        color: typeof it.color === 'string' ? it.color : 'text-purple-600',
        type: it.type === 'app' ? 'app' : 'folder',
        isCustom: typeof it.isCustom === 'boolean' ? it.isCustom : true,
        ...(it.folderId ? { folderId: String(it.folderId) } : {}),
      }))
      .filter((it) => it.id && it.name);

    const docRef = admin.firestore().collection('userSettings').doc(uid);
    await docRef.set({ taskbarItems: normalized, updatedAt: new Date() }, { merge: true });

    return res.json({ success: true, items: normalized });
  } catch (error) {
    console.error('Error saving taskbar items:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST /user/plan
router.post('/plan', async (req, res) => {
  try {
    const { uid } = req.user;
    const { planId, interval } = req.body || {};

    if (!planId) {
      return res.status(400).json({ error: 'planId requerido' });
    }

    if (interval && !isValidBillingInterval(interval)) {
      return res.status(400).json({ error: 'interval invalido' });
    }

    const plan = findPlanById(planId);
    if (!plan) {
      return res.status(400).json({ error: 'Plan invalido' });
    }

    const userRef = admin.firestore().collection('users').doc(uid);
    const userSnap = await userRef.get();

    if (!userSnap.exists) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    const userData = userSnap.data() || {};
    const usedBytes = (userData.usedBytes || 0) + (userData.pendingBytes || 0);

    if (usedBytes > plan.quotaBytes) {
      return res.status(409).json({
        error: 'No puedes cambiar a un plan con menos espacio del que ya usas',
        details: {
          usedBytes,
          targetQuotaBytes: plan.quotaBytes,
        },
      });
    }

    const planInterval = interval || 'monthly';
    await userRef.set(
      {
        planQuotaBytes: plan.quotaBytes,
        planId: plan.planId,
        planInterval,
        planUpdatedAt: new Date(),
      },
      { merge: true }
    );

    return res.json({
      success: true,
      planId: plan.planId,
      planQuotaBytes: plan.quotaBytes,
      planInterval,
    });
  } catch (error) {
    console.error('Error updating user plan:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;
