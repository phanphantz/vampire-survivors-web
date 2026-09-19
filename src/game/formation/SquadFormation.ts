import { MAX_SQUAD_SIZE, angleDiff, getAttackDirections, getFormationOffsets, rotateAndScale, rotateTowardAngle } from './Formation';
import type { FormationShape, Vec2 } from './Formation';

const DEFAULT_TURN_RATE_RAD_PER_SEC = Math.PI * 2; // a full reversal takes ~0.5s, not instant

// Column/wedge offsets encode "distance behind the front" as |offset.x| (0, 1, 2, ...). Each
// unit of that distance is read back this many seconds into the leader's trail, so a rotation
// reaches the front almost immediately and only reaches the back after a delay — a whip crack,
// not a rigid rotation. Circle has no front-to-back structure, so it's exempt (see below).
const PER_UNIT_TRAIL_DELAY_SEC = 0.18;
const TRAIL_RETENTION_SEC = 1.5;

interface TrailSample {
  t: number;
  pos: Vec2;
  angle: number;
}

/** Framework-agnostic formation state: shape, squad size, spacing, current facing, and the leader's trail. */
export class SquadFormation {
  shape: FormationShape;
  spacing: number;
  private count: number;
  private facingAngle = 0; // radians; 0 = facing +x — smoothed, catches up to targetFacingAngle
  private targetFacingAngle = 0; // last commanded heading; sticks after the key is released
  private turnRateRadPerSec: number;
  private elapsed = 0;
  private trail: TrailSample[] = [];

  constructor(count = 1, shape: FormationShape = 'wedge', spacing = 42, turnRateRadPerSec = DEFAULT_TURN_RATE_RAD_PER_SEC) {
    this.count = clampCount(count);
    this.shape = shape;
    this.spacing = spacing;
    this.turnRateRadPerSec = turnRateRadPerSec;
  }

  getCount(): number {
    return this.count;
  }

  setCount(count: number) {
    this.count = clampCount(count);
  }

  cycleShape() {
    const order: FormationShape[] = ['wedge', 'column', 'circle'];
    this.shape = order[(order.indexOf(this.shape) + 1) % order.length];
  }

  /**
   * Advances facing and records the leader's trail. Call once per frame before reading slot
   * positions/aim directions.
   *
   * A key press commits a heading: while held, the target tracks the input directly; once
   * released, the target sticks at the last direction and facing keeps turning toward it every
   * frame regardless, so even a brief tap eventually brings everyone fully around.
   */
  update(moveDir: Vec2, leaderPos: Vec2, dt: number) {
    if (moveDir.x !== 0 || moveDir.y !== 0) {
      this.targetFacingAngle = Math.atan2(moveDir.y, moveDir.x);
    }
    this.facingAngle = rotateTowardAngle(this.facingAngle, this.targetFacingAngle, this.turnRateRadPerSec * dt);

    this.elapsed += dt;
    this.trail.push({ t: this.elapsed, pos: { x: leaderPos.x, y: leaderPos.y }, angle: this.facingAngle });
    while (this.trail.length > 2 && this.elapsed - this.trail[0].t > TRAIL_RETENTION_SEC) {
      this.trail.shift();
    }
  }

  getSlotWorldPositions(leaderPos: Vec2): Vec2[] {
    const offsets = getFormationOffsets(this.shape, this.count);
    if (this.shape === 'circle') {
      return offsets.map((offset) => {
        const r = rotateAndScale(offset, this.facingAngle, this.spacing);
        return { x: leaderPos.x + r.x, y: leaderPos.y + r.y };
      });
    }
    return offsets.map((offset) => {
      const pose = this.sampleTrail(Math.abs(offset.x) * PER_UNIT_TRAIL_DELAY_SEC);
      const r = rotateAndScale({ x: 0, y: offset.y }, pose.angle, this.spacing);
      return { x: pose.pos.x + r.x, y: pose.pos.y + r.y };
    });
  }

  /** Per-slot aim direction (unit vectors) reflecting each formation's attack pattern. */
  getSlotAimWorldDirections(): Vec2[] {
    const dirs = getAttackDirections(this.shape, this.count);
    if (this.shape === 'circle') {
      return dirs.map((dir) => rotateAndScale(dir, this.facingAngle, 1));
    }
    const offsets = getFormationOffsets(this.shape, this.count);
    return dirs.map((dir, i) => {
      const pose = this.sampleTrail(Math.abs(offsets[i].x) * PER_UNIT_TRAIL_DELAY_SEC);
      return rotateAndScale(dir, pose.angle, 1);
    });
  }

  /** Interpolated {pos, angle} from `delaySec` seconds ago in the recorded trail. */
  private sampleTrail(delaySec: number): { pos: Vec2; angle: number } {
    const targetT = this.elapsed - delaySec;
    const oldest = this.trail[0];
    if (!oldest || targetT <= oldest.t) return oldest ?? { pos: { x: 0, y: 0 }, angle: this.facingAngle };

    for (let i = this.trail.length - 1; i > 0; i--) {
      const a = this.trail[i - 1];
      const b = this.trail[i];
      if (targetT >= a.t && targetT <= b.t) {
        const span = b.t - a.t;
        const frac = span > 1e-6 ? (targetT - a.t) / span : 0;
        return {
          pos: { x: a.pos.x + (b.pos.x - a.pos.x) * frac, y: a.pos.y + (b.pos.y - a.pos.y) * frac },
          angle: a.angle + angleDiff(b.angle, a.angle) * frac,
        };
      }
    }
    return this.trail[this.trail.length - 1];
  }
}

function clampCount(count: number): number {
  return Math.max(1, Math.min(MAX_SQUAD_SIZE, Math.round(count)));
}
