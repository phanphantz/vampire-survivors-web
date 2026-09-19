// Pure formation math — no Phaser types here on purpose.
// This is the part of the game that should port almost line-for-line to C#/Unity later.

export interface Vec2 {
  x: number;
  y: number;
}

export type FormationShape = 'column' | 'wedge' | 'circle';

export const MAX_SQUAD_SIZE = 5;

const WEDGE_PATTERN: Vec2[] = [
  { x: -1, y: -1 },
  { x: -1, y: 1 },
  { x: -2, y: -2 },
  { x: -2, y: 2 },
];

function columnOffsets(count: number): Vec2[] {
  return Array.from({ length: count }, (_, i) => ({ x: -i, y: 0 }));
}

// A lone apex point can't be split evenly, so a 2-person wedge is just a horizontal front
// rank. A 4-person wedge keeps that front rank but bows the rear rank outward wider — like an
// archer's bow curving away from its grip — instead of a pointed apex. Odd counts (1, 3, 5)
// keep the classic pointed-apex wedge via WEDGE_PATTERN.
function wedgeOffsets(count: number): Vec2[] {
  if (count === 2) return [{ x: 0, y: -0.5 }, { x: 0, y: 0.5 }];
  if (count === 4) {
    return [
      { x: 0, y: -0.5 },
      { x: 0, y: 0.5 },
      { x: -1, y: -1.5 },
      { x: -1, y: 1.5 },
    ];
  }
  const offsets: Vec2[] = [{ x: 0, y: 0 }];
  for (let i = 1; i < count; i++) offsets.push(WEDGE_PATTERN[i - 1]);
  return offsets;
}

function circleOffsets(count: number): Vec2[] {
  if (count === 1) return [{ x: 0, y: 0 }];
  return Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2;
    return { x: Math.cos(angle), y: Math.sin(angle) };
  });
}

// Circle's flipped alternative: paired front-to-back ranks (the flat rectangle briefly tried
// for the 4-person wedge), generalized to any count — any leftover odd member out sits centered
// at the back.
function boxOffsets(count: number): Vec2[] {
  const offsets: Vec2[] = [];
  const pairs = Math.floor(count / 2);
  for (let r = 0; r < pairs; r++) {
    offsets.push({ x: -r, y: -0.5 }, { x: -r, y: 0.5 });
  }
  if (count % 2 === 1) offsets.push({ x: -pairs, y: 0 });
  return offsets;
}

/** Local-space slot offsets (unscaled, unrotated). +x = forward, +y = right. */
export function getFormationOffsets(shape: FormationShape, count: number, mirrored = false): Vec2[] {
  const n = Math.max(1, Math.min(MAX_SQUAD_SIZE, count));
  switch (shape) {
    case 'column':
      return columnOffsets(n);
    case 'wedge':
      return wedgeOffsets(n);
    case 'circle':
      return mirrored ? boxOffsets(n) : circleOffsets(n);
  }
}

// Head fires forward, the rear fires backward — flipping never touches these two, only which
// flank each trailing "middle" member watches (mirrored left<->right when `mirrored` is set).
function columnAttackDirections(count: number, mirrored: boolean): Vec2[] {
  return Array.from({ length: count }, (_, i) => {
    if (i === 0) return { x: 1, y: 0 };
    if (i === count - 1) return { x: -1, y: 0 };
    const side = i % 2 === 1 ? 1 : -1;
    return { x: 0, y: mirrored ? -side : side };
  });
}

// The whole wedge pushes forward as one spearhead — flipped, it pushes backward instead.
function wedgeAttackDirections(count: number, mirrored: boolean): Vec2[] {
  const dir = mirrored ? -1 : 1;
  return Array.from({ length: count }, () => ({ x: dir, y: 0 }));
}

// The ring: each slot fires outward from wherever it stands, covering all around. Only the
// direction's angle is used downstream (see SquadFormation), so the offset vector doesn't need
// to be unit length.
function circleAttackDirections(count: number): Vec2[] {
  return circleOffsets(count).map((o) => (o.x === 0 && o.y === 0 ? { x: 1, y: 0 } : o));
}

// The box: unlike the ring, it has an actual front (see boxOffsets/boxLinks), so instead of
// radiating outward from each member's own spot it just aims with the squad, like wedge.
function boxAttackDirections(count: number): Vec2[] {
  return Array.from({ length: count }, () => ({ x: 1, y: 0 }));
}

/** Local-space aim direction per slot (unit vectors, unrotated). +x = forward, +y = right. */
export function getAttackDirections(shape: FormationShape, count: number, mirrored = false): Vec2[] {
  const n = Math.max(1, Math.min(MAX_SQUAD_SIZE, count));
  switch (shape) {
    case 'column':
      return columnAttackDirections(n, mirrored);
    case 'wedge':
      return wedgeAttackDirections(n, mirrored);
    case 'circle':
      return mirrored ? boxAttackDirections(n) : circleAttackDirections(n);
  }
}

export interface FormationLink {
  from: number;
  to: number;
}

// A straight chain: head-trail-...-back, matching the single-file layout.
function columnLinks(count: number): FormationLink[] {
  const links: FormationLink[] = [];
  for (let i = 0; i < count - 1; i++) links.push({ from: i, to: i + 1 });
  return links;
}

// Mirrors wedgeOffsets' layout: 2/4-person wedges link the front rank horizontally (and the
// back rank to its matching front-rank member); odd counts keep the apex-rooted arms.
function wedgeLinks(count: number): FormationLink[] {
  if (count === 2) return [{ from: 0, to: 1 }];
  if (count === 4) {
    return [
      { from: 0, to: 1 },
      { from: 0, to: 2 },
      { from: 1, to: 3 },
    ];
  }
  const links: FormationLink[] = [];
  for (let i = 1; i < count; i++) {
    links.push(i <= 2 ? { from: 0, to: i } : { from: i - 2, to: i });
  }
  return links;
}

// A closed ring connecting neighbors around the circle.
function circleLinks(count: number): FormationLink[] {
  if (count < 2) return [];
  const links: FormationLink[] = [];
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % count;
    if (count === 2 && j < i) continue; // a pair only needs one edge, not two
    links.push({ from: i, to: j });
  }
  return links;
}

// Mirrors boxOffsets' layout: each pair gets a horizontal rung, each pair beyond the first
// rails back to the matching side of the pair in front of it, and a leftover odd member out
// links back to the last pair's near side.
function boxLinks(count: number): FormationLink[] {
  const links: FormationLink[] = [];
  const pairs = Math.floor(count / 2);
  for (let r = 0; r < pairs; r++) {
    const left = r * 2;
    const right = r * 2 + 1;
    links.push({ from: left, to: right });
    if (r > 0) {
      links.push({ from: left - 2, to: left }, { from: right - 2, to: right });
    }
  }
  if (count % 2 === 1 && count > 1) {
    links.push({ from: (pairs - 1) * 2, to: count - 1 });
  }
  return links;
}

/** Which slot indices should be visually connected, reflecting each formation's topology. */
export function getFormationLinks(shape: FormationShape, count: number, mirrored = false): FormationLink[] {
  const n = Math.max(1, Math.min(MAX_SQUAD_SIZE, count));
  switch (shape) {
    case 'column':
      return columnLinks(n);
    case 'wedge':
      return wedgeLinks(n);
    case 'circle':
      return mirrored ? boxLinks(n) : circleLinks(n);
  }
}

export function rotateAndScale(offset: Vec2, angleRad: number, spacing: number): Vec2 {
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  return {
    x: (offset.x * cos - offset.y * sin) * spacing,
    y: (offset.x * sin + offset.y * cos) * spacing,
  };
}

/** Shortest signed difference `a - b`, wrapped to [-PI, PI]. */
export function angleDiff(a: number, b: number): number {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

/** Turns `current` toward `target` by at most `maxDelta` radians — smooth, not instant, rotation. */
export function rotateTowardAngle(current: number, target: number, maxDelta: number): number {
  const diff = angleDiff(target, current);
  if (Math.abs(diff) <= maxDelta) return current + diff;
  return current + Math.sign(diff) * maxDelta;
}

/**
 * Buckets a screen-space angle (0 = +x/East, increasing clockwise) into one of 8 compass
 * directions, ordered N, NE, E, SE, S, SW, W, NW (0-7) — matching the layout of an 8-directional
 * sprite sheet laid out in that order.
 */
export function angleToDirection8(angleRad: number): number {
  const steps = Math.round((angleRad + Math.PI / 2) / (Math.PI / 4));
  return ((steps % 8) + 8) % 8;
}
