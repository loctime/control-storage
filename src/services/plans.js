const path = require('path');
const fs = require('fs');

let cachedPlans = null;

function loadCatalog() {
  if (cachedPlans) return cachedPlans;

  const plansPath = path.resolve(__dirname, '../../config/plans.json');
  const raw = fs.readFileSync(plansPath, 'utf8');
  cachedPlans = JSON.parse(raw);
  return cachedPlans;
}

function findPlanById(planId) {
  const catalog = loadCatalog();
  if (!planId || typeof planId !== 'string') return null;

  if (catalog.free && catalog.free.planId === planId) {
    return catalog.free;
  }

  const plans = Array.isArray(catalog.plans) ? catalog.plans : [];
  return plans.find((plan) => plan.planId === planId) || null;
}

function getPlanPrice(plan, interval = 'monthly') {
  if (!plan) return 0;
  if (interval === 'yearly') {
    return plan.yearlyPrice != null ? plan.yearlyPrice : Number(plan.price || 0) * 12;
  }
  return Number(plan.price || 0);
}

module.exports = {
  loadCatalog,
  findPlanById,
  getPlanPrice,
};
