import { MAX_SQUAD_SIZE, angleDiff, getAttackDirections, getFormationOffsets, rotateAndScale, rotateTowardAngle } from './Formation';
import type { FormationShape, Vec2 } from './Formation';

const DEFAULT_TURN_RATE_RAD_PER_SEC = Math.PI * 2; // a full reversal takes ~0.5s, not instant

// Column/wedge offsets encode "distance behind the front" as |offset.x| formation-spacing units.
// Rather than rotate every slot rigidly around the same instantaneous angle, each slot is placed
// by walking `|offset.x| * spacing` back along the leader's actual recent path — the front reacts
// immediately, the back only catches up once its point in the path reaches there, producing a
// whip-like sequential swing on rotation. Indexed by distance (not time) so a slot's position
// stays put once the leader stops, instead of collapsing back onto it. Circle has no
// front-to-back structure, so it's exempt (see below) and just rotates rigidly.
const TRAIL_RETENTION_MULTIPLIER = 3; // keep enough path behind for the largest offset, with headroom

interface TrailSample {
  dist: number; // cumulative distance the leader had traveled when this sample was recorded
  pos: Vec2;
  angle: number;
}

/** Framework-agnostic formation state: shape, squad size, spacing, current facing, and the leader's path trail. */
export class SquadFormation {
  shape: FormationShape;
  spacing: number;
  private count: number;
  private facingAngle = 0; // radians; 0 = facing +x — smoothed, catches up to targetFacingAngle
  private targetFacingAngle = 0; // last commanded heading; sticks after the key is released
  private turnRateRadPerSec: number;
  private traveledDistance = 0;
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
   * Advances facing and records the leader's path trail. Call once per frame before reading
   * slot positions/aim directions.
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

    const last = this.trail[this.trail.length - 1];
    if (last) {
      this.traveledDistance += Math.hypot(leaderPos.x - last.pos.x, leaderPos.y - last.pos.y);
    }
    this.trail.push({ dist: this.traveledDistance, pos: { x: leaderPos.x, y: leaderPos.y }, angle: this.facingAngle });

    const maxBehind = this.spacing * MAX_SQUAD_SIZE * TRAIL_RETENTION_MULTIPLIER;
    while (this.trail.length > 2 && this.traveledDistance - this.trail[0].dist > maxBehind) {
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
      const pose = this.sampleBehind(Math.abs(offset.x) * this.spacing);
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
      const pose = this.sampleBehind(Math.abs(offsets[i].x) * this.spacing);
      return rotateAndScale(dir, pose.angle, 1);
    });
  }

  /**
   * {pos, angle} exactly `distanceBehind` px back along the leader's traveled path. If the
   * leader hasn't traveled far enough yet (e.g. just spawned), extrapolates straight back from
   * the oldest known pose instead of clamping — so the formation still has correct static
   * spacing even before the leader has taken a single step.
   */
  private sampleBehind(distanceBehind: number): { pos: Vec2; angle: number } {
    const targetDist = this.traveledDistance - distanceBehind;
    const oldest = this.trail[0];
    if (!oldest) return { pos: { x: 0, y: 0 }, angle: this.facingAngle };

    if (targetDist <= oldest.dist) {
      const shortfall = oldest.dist - targetDist;
      return {
        pos: {
          x: oldest.pos.x - Math.cos(oldest.angle) * shortfall,
          y: oldest.pos.y - Math.sin(oldest.angle) * shortfall,
        },
        angle: oldest.angle,
      };
    }

    for (let i = this.trail.length - 1; i > 0; i--) {
      const a = this.trail[i - 1];
      const b = this.trail[i];
      if (targetDist >= a.dist && targetDist <= b.dist) {
        const span = b.dist - a.dist;
        const frac = span > 1e-6 ? (targetDist - a.dist) / span : 0;
        return {
          pos: { x: a.pos.x + (b.pos.x - a.pos.x) * frac, y: a.pos.y + (b.pos.y - a.pos.y) * frac },
          angle: a.angle + angleDiff(b.angle, a.angle) * frac,
        };
      }
    }
    const latest = this.trail[this.trail.length - 1];
    return { pos: latest.pos, angle: latest.angle };
  }
}

function clampCount(count: number): number {
  return Math.max(1, Math.min(MAX_SQUAD_SIZE, Math.round(count)));
}
