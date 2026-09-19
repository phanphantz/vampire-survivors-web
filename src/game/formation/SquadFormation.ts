import { MAX_SQUAD_SIZE, getFormationOffsets, rotateAndScale } from './Formation';
import type { FormationShape, Vec2 } from './Formation';

/** Framework-agnostic formation state: shape, squad size, spacing, and current facing. */
export class SquadFormation {
  shape: FormationShape;
  spacing: number;
  private count: number;
  private facingAngle = 0; // radians; 0 = facing +x

  constructor(count = 1, shape: FormationShape = 'wedge', spacing = 42) {
    this.count = clampCount(count);
    this.shape = shape;
    this.spacing = spacing;
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

  /** Only rotates facing when actually moving, so formation holds orientation while idle. */
  updateFacing(moveDir: Vec2) {
    if (moveDir.x === 0 && moveDir.y === 0) return;
    this.facingAngle = Math.atan2(moveDir.y, moveDir.x);
  }

  getSlotWorldPositions(leaderPos: Vec2): Vec2[] {
    return getFormationOffsets(this.shape, this.count).map((offset) => {
      const r = rotateAndScale(offset, this.facingAngle, this.spacing);
      return { x: leaderPos.x + r.x, y: leaderPos.y + r.y };
    });
  }
}

function clampCount(count: number): number {
  return Math.max(1, Math.min(MAX_SQUAD_SIZE, Math.round(count)));
}
