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
 * so it rotates rigidly as one ring instead — unless flipped, which swaps it for a paired
 * front-to-back "box" layout (see Formation.boxOffsets) that *does* chain-follow like the others.
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

  constructor(count = 1, shape: FormationShape = 'wedge', spacing = 50, turnRateRadPerSec = DEFAULT_TURN_RATE_RAD_PER_SEC) {
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
   * Wedge/column: flips shooting direction only (wedge fires backward instead of forward;
   * column mirrors which flank each trailing "middle" member watches, head/back untouched) —
   * positions are unaffected. Circle: swaps its rigid ring for the paired-rank "box" layout
   * instead (positions *and* topology change; shooting direction follows along).
   */
  toggleFlip() {
    this.flipped = !this.flipped;
  }

  isFlipped(): boolean {
    return this.flipped;
  }

  /** True while circle is showing its plain rotating ring (not flipped into the box layout). */
  private isRigidCircle(): boolean {
    return this.shape === 'circle' && !this.flipped;
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
    if (this.isRigidCircle()) {
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
    if (this.isRigidCircle()) {
      return dirs.map((dir) => rotateAndScale(dir, this.facingAngle, 1));
    }
    return dirs.map((dir, i) => rotateAndScale(dir, this.slotAngles[i] ?? this.facingAngle, 1));
  }

  /** Relaxes each non-head slot's orientation toward its parent's, and places it a fixed link-length behind. */
  private updateChain(leaderPos: Vec2, dt: number) {
    const offsets = getFormationOffsets(this.shape, this.count, this.flipped);
    const parents = getFollowParents(this.shape, this.count, this.flipped);

    // Usually offsets[0] is (0,0) (the head sits exactly at the leader), but 2/4-person wedges
    // put a horizontal front rank there instead, so slot 0 itself needs the rotated offset too.
    const r0 = rotateAndScale(offsets[0], this.facingAngle, this.spacing);
    this.slotAngles[0] = this.facingAngle;
    this.slotPositions[0] = { x: leaderPos.x + r0.x, y: leaderPos.y + r0.y };

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
function getFollowParents(shape: FormationShape, count: number, mirrored: boolean): (number | null)[] {
  const parents: (number | null)[] = new Array(count).fill(null);
  const isRigidCircle = shape === 'circle' && !mirrored;
  const links: FormationLink[] = isRigidCircle ? [] : getFormationLinks(shape, count, mirrored);
  for (const link of links) parents[link.to] = link.from;
  return parents;
}

function clampCount(count: number): number {
  return Math.max(1, Math.min(MAX_SQUAD_SIZE, Math.round(count)));
}
