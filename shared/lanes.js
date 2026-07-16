// The seven lanes Robin wants to keep making progress in, plus a catch-all.
//
// Tana has 20 Life Areas that grew organically and don't line up with these.
// Rather than re-tagging the graph, we map areas -> lanes here. Tana stays untouched.

// Hues sit ~40 apart so no two lanes read as the same colour at ring size.
export const LANES = [
  { key: 'zazen', label: 'Zazen', hue: 268 },
  { key: 'body',  label: 'Body',  hue: 145 },
  { key: 'music', label: 'Music', hue: 25 },
  { key: 'art',   label: 'Art',   hue: 345 },
  { key: 'forro', label: 'Forró', hue: 70 },
  { key: 'work',  label: 'Work',  hue: 220 },
  { key: 'admin', label: 'Admin', hue: 190 },
  // Optional by design: an hour's siesta is what peak form needs, but it must
  // never read as a failure when the work is going well.
  { key: 'rest',  label: 'Rest',  hue: 305, optional: true },
  { key: 'other', label: 'Other', hue: 0, untracked: true },
];

export const LANE_KEYS = LANES.map((l) => l.key);

// Tana Life Area name -> lane key. Anything unlisted falls through to 'other',
// which is shown but carries no daily target.
export const AREA_TO_LANE = {
  // Zazen: no Life Area of that name exists; sitting lives under well-being.
  'Well-being / Mind / Spirit': 'zazen',

  'Body / Health': 'body',
  'Somatic Studio': 'body',

  'Music': 'music',
  'Art': 'art',

  // Forró: no Life Area of that name either; it's the dance area.
  'Dance': 'forro',

  // Work is the earning lane only, so its progress ring means actual earning time.
  'Business': 'work',
  'Stone Grinder': 'work',
  'Incremento': 'work',
  'Portugal Portfolio': 'work',
  'Lisbon Sintra Tours': 'work',

  // Admin is personal admin, which is where the big organic catch-alls really sit.
  'Tool / Admin': 'admin',
  'Tool': 'admin',        // stray near-duplicate of the above, 1 task
  'My Life': 'admin',
  'Portugal': 'admin',
  'Money': 'admin',       // personal finance, not income

  // Deliberately unmapped -> 'other': relationships and language study have no
  // lane of their own, and ~35 tasks carry no Area at all.
  // Maya Das, Tara L-S, People, Society, Língua Portuguesa
};

export function laneForArea(area) {
  if (!area) return 'other';
  return AREA_TO_LANE[area.trim()] || 'other';
}

export function laneMeta(key) {
  return LANES.find((l) => l.key === key) || LANES[LANES.length - 1];
}
