import { MAX_SQUAD_SIZE, getAttackDirections, getFormationLinks, getFormationOffsets, rotateAndScale, rotateTowardAngle } from './Formation';
import type { FormationLink, FormationShape, Vec2 } from './Formation';

const DEFAULT_TURN_RATE_RAD_PER_SEC = Math.PI * 2; // a full reversal takes ~0.5s, not instant
const CHAIN_TURN_RATE_FACTOR = 0.7; // each link chases its parent a bit slower than the head turns, so lag compounds down the line

/**
 * Framework-agnostic formation state: shape, squad size, spacing, current facing, and a
 * per-slot orientation chain.
 *
 * Column/wedge slots don't just rotate rigidly around the leader: each non-head slot's own
 * orientation smoothly chases the slot it's linked to (see Formation.getFormationLinks, whose
 * `from` is always the more-forward slot), and its position is placed a fixed link-length
 * behind that parent along the parent's *current* orientation. Because the chase runs every
 * frame off elapsed time — not distance traveled — a heading change always fully propagates
 * down the chain eventually, even from a brief tap that barely moves the squad; it just does so
 * with a cascading delay, front to back, like a whip. Once everything has caught up this
 * reduces to exactly the plain rigid-offset formation. Circle has no front-to-back structure,
 * so it's exempt and just rotates rigidly as one ring.
 */
export class SquadFormation {
  shape: FormationShape;
  spacing: number;
  private count: number;
  private facingAngle = 0; // radians; 0 = facing +x — smoothed, catches up to targetFacingAngle
  private targetFacingAngle = 0; // last commanded heading; sticks after the key is released
  private turnRateRadPerSec: number;
  private chainTurnRateRadPerSec: number;

  private slotAngles: number[] = [];
  private slotPositions: Vec2[] = [];
  private flipped = false;

  constructor(count = 1, shape: FormationShape = 'wedge', spacing = 42, turnRateRadPerSec = DEFAULT_TURN_RATE_RAD_PER_SEC) {
    this.count = clampCount(count);
    this.shape = shape;
    this.spacing = spacing;
    this.turnRateRadPerSec = turnRateRadPerSec;
    this.chainTurnRateRadPerSec = turnRateRadPerSec * CHAIN_TURN_RATE_FACTOR;
  }

  getCount(): number {
    return this.count;
  }

  setCount(count: number) {
    this.count = clampCount(count);
    // Truncate rather than leave stale entries — if the squad grows again later, a fresh
    // slot is re-seeded in place instead of resuming some long-dead cached angle.
    this.slotAngles.length = this.count;
    this.slotPositions.length = this.count;
  }

  cycleShape() {
    const order: FormationShape[] = ['wedge', 'column', 'circle'];
    this.shape = order[(order.indexOf(this.shape) + 1) % order.length];
  }

  /**
   * Flips shooting direction: wedge fires backward instead of forward; column mirrors which
   * flank each trailing "middle" member watches, leaving the head (front) and back untouched.
   * Positions are unaffected.
   */
  toggleFlip() {
    this.flipped = !this.flipped;
  }

  isFlipped(): boolean {
    return this.flipped;
  }

  /**
   * Advances facing and the per-slot orientation chain. Call once per frame before reading
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

    // Kept warm even while shape is 'circle' (unused there) so the chain is already valid the
    // instant the shape is switched mid-frame — cycleShape() runs after this in MainScene's
    // update loop, and slot reads must never lag a frame behind the shape they're reading for.
    this.updateChain(leaderPos, dt);
  }

  getSlotWorldPositions(leaderPos: Vec2): Vec2[] {
    if (this.shape === 'circle') {
      return getFormationOffsets(this.shape, this.count).map((offset) => {
        const r = rotateAndScale(offset, this.facingAngle, this.spacing);
        return { x: leaderPos.x + r.x, y: leaderPos.y + r.y };
      });
    }
    return this.slotPositions.slice(0, this.count);
  }

  /** Per-slot aim direction (unit vectors) reflecting each formation's attack pattern. */
  getSlotAimWorldDirections(): Vec2[] {
    const dirs = getAttackDirections(this.shape, this.count, this.flipped);
    if (this.shape === 'circle') {
      return dirs.map((dir) => rotateAndScale(dir, this.facingAngle, 1));
    }
    return dirs.map((dir, i) => rotateAndScale(dir, this.slotAngles[i] ?? this.facingAngle, 1));
  }

  /** Relaxes each non-head slot's orientation toward its parent's, and places it a fixed link-length behind. */
  private updateChain(leaderPos: Vec2, dt: number) {
    const offsets = getFormationOffsets(this.shape, this.count);
    const parents = getFollowParents(this.shape, this.count);

    this.slotAngles[0] = this.facingAngle;
    this.slotPositions[0] = { x: leaderPos.x, y: leaderPos.y };

    for (let i = 1; i < this.count; i++) {
      const parent = parents[i];
      if (parent === null) {
        // No defined link (shouldn't happen for column/wedge, but stay safe): snap to the rigid offset.
        const r = rotateAndScale(offsets[i], this.facingAngle, this.spacing);
        this.slotAngles[i] = this.facingAngle;
        this.slotPositions[i] = { x: leaderPos.x + r.x, y: leaderPos.y + r.y };
        continue;
      }

      if (this.slotAngles[i] === undefined) this.slotAngles[i] = this.slotAngles[parent]; // seed newly-added slots in place, no pop-in

      this.slotAngles[i] = rotateTowardAngle(this.slotAngles[i], this.slotAngles[parent], this.chainTurnRateRadPerSec * dt);

      const localLink = { x: offsets[i].x - offsets[parent].x, y: offsets[i].y - offsets[parent].y };
      const r = rotateAndScale(localLink, this.slotAngles[parent], this.spacing);
      const parentPos = this.slotPositions[parent];
      this.slotPositions[i] = { x: parentPos.x + r.x, y: parentPos.y + r.y };
    }
  }
}

/** For each slot, the index of the more-forward slot it's linked to (null for the head). */
function getFollowParents(shape: FormationShape, count: number): (number | null)[] {
  const parents: (number | null)[] = new Array(count).fill(null);
  const links: FormationLink[] = shape === 'circle' ? [] : getFormationLinks(shape, count);
  for (const link of links) parents[link.to] = link.from;
  return parents;
}

function clampCount(count: number): number {
  return Math.max(1, Math.min(MAX_SQUAD_SIZE, Math.round(count)));
}
