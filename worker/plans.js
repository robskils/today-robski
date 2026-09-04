// The tiers, in one place.
//
// STORED KEYS DESCRIBE THE ARRANGEMENT, NOT THE MARKETING NAME. The name has
// changed three times (Standard/Premium, then Full Fat, now Premium Plus) and the
// arrangement has not, so the database should not have to move every time the
// pricing page does.
//
//   free    - capped, no AI                                      (UI: Free)
//   byok    - everything, running on the user's own AI keys       (UI: Premium)
//   managed - everything, and we supply and pay for the AI        (UI: Premium Plus)
//
// The old keys were 'standard' (= byok) and 'premium' (= managed). Note the trap:
// 'premium' used to mean the MANAGED tier, and the word now labels the cheaper
// one. Any bare `plan === 'premium'` test would hand our API keys to every €6
// customer, so every check goes through isManaged() instead.
export const PLAN_KEYS = ['free', 'byok', 'managed'];
export const PLAN_LABEL = { free: 'Free', byok: 'Premium', managed: 'Premium Plus' };
const LEGACY = { standard: 'byok', premium: 'managed' };

// Read path only, and deliberately tolerant: a row restored from an old backup,
// or written by a client that hasn't reloaded, still resolves to the right tier.
export function normPlan(p) {
  const k = String(p || '').toLowerCase();
  if (PLAN_KEYS.includes(k)) return k;
  return LEGACY[k] || 'free';
}
export const isManaged = (p) => normPlan(p) === 'managed';
export const planLabel = (p) => PLAN_LABEL[normPlan(p)];
