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

function wedgeOffsets(count: number): Vec2[] {
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

/** Local-space slot offsets (unscaled, unrotated). +x = forward, +y = right. */
export function getFormationOffsets(shape: FormationShape, count: number): Vec2[] {
  const n = Math.max(1, Math.min(MAX_SQUAD_SIZE, count));
  switch (shape) {
    case 'column':
      return columnOffsets(n);
    case 'wedge':
      return wedgeOffsets(n);
    case 'circle':
      return circleOffsets(n);
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
