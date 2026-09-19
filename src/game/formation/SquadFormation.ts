import { MAX_SQUAD_SIZE, getAttackDirections, getFormationOffsets, rotateAndScale, rotateTowardAngle } from './Formation';
import type { FormationShape, Vec2 } from './Formation';

const DEFAULT_TURN_RATE_RAD_PER_SEC = Math.PI * 2; // a full reversal takes ~0.5s, not instant

/** Framework-agnostic formation state: shape, squad size, spacing, and current facing. */
export class SquadFormation {
  shape: FormationShape;
  spacing: number;
  private count: number;
  private facingAngle = 0; // radians; 0 = facing +x — smoothed, catches up to targetFacingAngle
  private targetFacingAngle = 0; // last commanded heading; sticks after the key is released
  private turnRateRadPerSec: number;

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
   * A key press commits a heading: while held, the target tracks the input directly; once
   * released, the target sticks at the last direction and the formation keeps turning toward
   * it every frame regardless, so even a brief tap eventually brings everyone fully around.
   */
  updateFacing(moveDir: Vec2, dt: number) {
    if (moveDir.x !== 0 || moveDir.y !== 0) {
      this.targetFacingAngle = Math.atan2(moveDir.y, moveDir.x);
    }
    this.facingAngle = rotateTowardAngle(this.facingAngle, this.targetFacingAngle, this.turnRateRadPerSec * dt);
  }

  getSlotWorldPositions(leaderPos: Vec2): Vec2[] {
    return getFormationOffsets(this.shape, this.count).map((offset) => {
      const r = rotateAndScale(offset, this.facingAngle, this.spacing);
      return { x: leaderPos.x + r.x, y: leaderPos.y + r.y };
    });
  }

  /** Per-slot aim direction (unit vectors) reflecting each formation's attack pattern. */
  getSlotAimWorldDirections(): Vec2[] {
    return getAttackDirections(this.shape, this.count).map((dir) => rotateAndScale(dir, this.facingAngle, 1));
  }
}

function clampCount(count: number): number {
  return Math.max(1, Math.min(MAX_SQUAD_SIZE, Math.round(count)));
}
