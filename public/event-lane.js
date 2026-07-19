// Deciding whether a calendar event names a practice.
//
// A sat Zazen that's already on the calendar shouldn't have to be retyped as a
// block to count. If an event's title names a lane, or one of that lane's
// activities, the app offers to adopt it. It only ever offers: the click is
// Robin's, because "Art" in a title doesn't always mean he painted.
//
// Pure and dependency-free so it can be tested directly. The browser passes in
// the lanes and activities it got from /api/day.

// Accents off, case off. "Forró" and "forro" are the same word to a matcher.
export const fold = (s) =>
  String(s || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Whole words only. Without the boundaries, Work swallows "Workshop", Art
// swallows "Artichoke delivery", and Body swallows "Bodyboarding" - each one
// quietly crediting practice for something that wasn't practice.
// \b is no use here: it's ASCII-only, so "Forró" would break at the ó.
function names(title, word) {
  const n = fold(word);
  if (!n) return false;
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escRe(n)}([^\\p{L}\\p{N}]|$)`, 'u').test(title);
}

export function laneForEvent(title, lanes = [], activities = []) {
  const t = fold(title);
  if (!t) return null;

  // Lane names first: coarser, and more deliberate than an activity name.
  // Untracked lanes (Other) have no target, so there's nothing to credit.
  const lane = lanes.find((l) => !l.untracked && names(t, l.label));
  if (lane) return lane.key;

  // Then activities, so "Forró" finds Music & Dance without naming it.
  const act = activities.find((a) => names(t, a.title));
  return act ? act.lane : null;
}
