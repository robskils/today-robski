// The seven lanes Robin wants to keep making progress in, plus a catch-all.
//
// Tana has 20 Life Areas that grew organically and don't line up with these.
// Rather than re-tagging the graph, we map areas -> lanes here. Tana stays untouched.

// Hues sit ~40 apart so no two lanes read as the same colour at ring size.
//
// `zen` is the Sōtō name for the practice, and only appears where it's honest.
// A monastery has no word for forró, and inventing one would be costume.
export const LANES = [
  // practice: true = never receives tasks, only bare blocks. Zazen is not a
  // category of work to get through, it's something done every day. Nothing
  // should ever map an Area onto it.
  { key: 'zazen', label: 'Zazen', hue: 268, practice: true,
    zen: { kanji: '坐禅', romaji: 'zazen', gloss: 'just sitting' } },
  // Body is a practice too: yoga, HIT, chi kung. They're done from the app's
  // own activity list, not from a Tana backlog.
  { key: 'body',  label: 'Body',  hue: 145, practice: true,
    zen: { kanji: '体操', romaji: 'taisō', gloss: 'the body prepared' } },
  // Music & Dance is a practice too, and one lane rather than two: forró,
  // percussion, singing and songwriting are all the same hour of the day
  // competing for the same attention. Splitting them just split the ring.
  { key: 'music', label: 'Music & Dance', hue: 25, practice: true },
  { key: 'art',   label: 'Art',   hue: 345 },
  { key: 'portuguese', label: 'Portuguese', hue: 110 },
  // Samu is work as practice, not work as interruption to practice. Which is
  // the whole reason earning a living belongs on this schedule at all.
  { key: 'work',  label: 'Work',  hue: 220,
    zen: { kanji: '作務', romaji: 'samu', gloss: 'work as practice' } },
  // Everything that is just living: admin, money, Portugal, the body's upkeep.
  // Was called Admin, which undersold it.
  { key: 'mylife', label: 'My Life', hue: 190 },
  // Optional by design: an hour's siesta is what peak form needs, but it must
  // never read as a failure when the work is going well. Hōsan is the
  // monastery's own word for a period released from the formal schedule.
  { key: 'rest',  label: 'Rest',  hue: 305, optional: true, practice: true,
    zen: { kanji: '放参', romaji: 'hōsan', gloss: 'released from the schedule' } },
  { key: 'other', label: 'Other', hue: 0, untracked: true },
];

export const LANE_KEYS = LANES.map((l) => l.key);

// Tana Life Area name -> lane key. Anything unlisted falls through to 'other',
// which is shown but carries no daily target.
export const AREA_TO_LANE = {
  // Nothing maps to zazen, body or music. All three are practices: sitting;
  // yoga / HIT / chi kung; forró / percussion / singing / songwriting. They're
  // filled from the app's own activity list, not from a Tana backlog.
  //
  // Their old areas moved to My Life, because "sort out playlists" is life
  // admin, not an hour of playing. Same reasoning as "book a physio" not being
  // a workout.
  'Music': 'mylife',
  'Dance': 'mylife',

  'Art': 'art',
  'Língua Portuguesa': 'portuguese',

  // Work is the earning lane only, so its progress ring means actual earning time.
  'Business': 'work',
  'Stone Grinder': 'work',
  'Incremento': 'work',
  'Portugal Portfolio': 'work',
  'Lisbon Sintra Tours': 'work',

  // My Life is everything that is simply living.
  'My Life': 'mylife',
  'Tool / Admin': 'mylife',
  'Tool': 'mylife',           // stray near-duplicate of the above, 1 task
  'Portugal': 'mylife',
  'Money': 'mylife',          // personal finance, not income
  'Body / Health': 'mylife',
  'Somatic Studio': 'mylife',

  // Deliberately unmapped -> 'other': relationships and Zen study have no lane
  // of their own, and ~35 tasks carry no Area at all.
  // Maya Das, Tara L-S, People, Society, Well-being / Mind / Spirit
};

export function laneForArea(area) {
  if (!area) return 'other';
  return AREA_TO_LANE[area.trim()] || 'other';
}

export function laneMeta(key) {
  return LANES.find((l) => l.key === key) || LANES[LANES.length - 1];
}
