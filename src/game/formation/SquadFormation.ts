import { MAX_SQUAD_SIZE, getAttackDirections, getFormationLinks, getFormationOffsets, rotateAndScale, rotateTowardAngle } from './Formation';
import type { FormationLink, FormationShape, Vec2 } from './Formation';

const DEFAULT_TURN_RATE_RAD_PER_SEC = Math.PI * 2; // a full reversal takes ~0.5s, not instant
const CHAIN_TURN_RATE_FACTOR = 0.7; // each link chases its parent a bit slower than the head turns, so lag compounds down the line
const TRAIL_RETENTION_MULTIPLIER = 3; // keep enough recorded path behind for the largest offset, with headroom

interface TrailSample {
  dist: number; // cumulative distance the leader had traveled when this sample was recorded
  pos: Vec2;
}

/**
 * Framework-agnostic formation state: shape, squad size, spacing, current facing, and a
 * per-slot orientation chain.
 *
 * Column/wedge slots don't just rotate rigidly around the leader: each non-head slot's own
 * orientation smoothly chases the slot it's linked to (see Formation.getFormationLinks, whose
 * `from` is always the more-forward slot). Because that chase runs every frame off elapsed time
 * — not distance traveled — a heading change always fully propagates down the chain eventually,
 * even from a brief tap that barely moves the squad; it just does so with a cascading delay,
 * front to back, like a whip. This orientation chain alone is what aim direction uses, and it's
 * unaffected by anything below.
 *
 * Position is where wedge/box and column differ. Wedge/box slots are placed a fixed link-length
 * behind their parent along the parent's *current* orientation — rigid rods with a lagging
 * joint, which suits a formation with lateral spread. Column has none, so instead each slot
 * literally walks the path the leader already walked: a trail of the leader's recent positions
 * is recorded every frame, and slot i sits at the point exactly `i * spacing` of *traveled
 * distance* back along it — a snake/conga-line curve through turns, not a rotated offset.
 * Indexed by distance (not time) so a slot's position stays put once the leader stops, instead
 * of collapsing back onto it, with extrapolation from the oldest recorded pose for when the
 * leader hasn't traveled far enough yet (e.g. right after spawn).
 *
 * Circle has no front-to-back structure, so it rotates rigidly as one ring instead — unless
 * flipped, which swaps it for a paired front-to-back "box" layout (see Formation.boxOffsets)
 * that chain-follows like wedge.
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
  private traveledDistance = 0; // column only: cumulative distance the leader has walked, used to index the trail
  private trail: TrailSample[] = []; // column only: recent leader path, sampled for the snake-like follow

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
    const isColumn = this.shape === 'column';
    if (isColumn) this.recordTrail(leaderPos);

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

      if (isColumn) {
        // Snake-like: walk the leader's actual recorded path instead of rotating a fixed offset
        // off the parent — |offsets[i].x| is already "how far behind the front" in spacing units.
        this.slotPositions[i] = this.sampleTrailPosition(Math.abs(offsets[i].x) * this.spacing);
      } else {
        const localLink = { x: offsets[i].x - offsets[parent].x, y: offsets[i].y - offsets[parent].y };
        const r = rotateAndScale(localLink, this.slotAngles[parent], this.spacing);
        const parentPos = this.slotPositions[parent];
        this.slotPositions[i] = { x: parentPos.x + r.x, y: parentPos.y + r.y };
      }
    }
  }

  private recordTrail(leaderPos: Vec2) {
    const last = this.trail[this.trail.length - 1];
    if (last) {
      this.traveledDistance += Math.hypot(leaderPos.x - last.pos.x, leaderPos.y - last.pos.y);
    }
    this.trail.push({ dist: this.traveledDistance, pos: { x: leaderPos.x, y: leaderPos.y } });

    const maxBehind = this.spacing * MAX_SQUAD_SIZE * TRAIL_RETENTION_MULTIPLIER;
    while (this.trail.length > 2 && this.traveledDistance - this.trail[0].dist > maxBehind) {
      this.trail.shift();
    }
  }

  /**
   * Position exactly `distanceBehind` px back along the leader's traveled path. If the leader
   * hasn't traveled far enough yet (e.g. just spawned), extrapolates straight back from the
   * oldest known point along the current facing instead of clamping, so the column still has
   * correct static spacing even before the leader has taken a single step.
   */
  private sampleTrailPosition(distanceBehind: number): Vec2 {
    const targetDist = this.traveledDistance - distanceBehind;
    const oldest = this.trail[0];
    if (!oldest) return { x: 0, y: 0 };

    if (targetDist <= oldest.dist) {
      const shortfall = oldest.dist - targetDist;
      return {
        x: oldest.pos.x - Math.cos(this.facingAngle) * shortfall,
        y: oldest.pos.y - Math.sin(this.facingAngle) * shortfall,
      };
    }

    for (let i = this.trail.length - 1; i > 0; i--) {
      const a = this.trail[i - 1];
      const b = this.trail[i];
      if (targetDist >= a.dist && targetDist <= b.dist) {
        const span = b.dist - a.dist;
        const frac = span > 1e-6 ? (targetDist - a.dist) / span : 0;
        return { x: a.pos.x + (b.pos.x - a.pos.x) * frac, y: a.pos.y + (b.pos.y - a.pos.y) * frac };
      }
    }
    return this.trail[this.trail.length - 1].pos;
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
