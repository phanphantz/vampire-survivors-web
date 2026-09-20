import Phaser from 'phaser';
import { angleToDirection8, rotateTowardAngle } from '../formation/Formation';
import type { Vec2 } from '../formation/Formation';
import { CHARACTER_DISPLAY_HEIGHT, CHARACTER_FRAME_HEIGHT, CHARACTER_TEXTURE, frameFootRow, idleAnimKey } from '../scenes/BootScene';

export type AttackKind = 'shot' | 'arrow' | 'daggers' | 'sword' | 'spear';

export interface CharacterStats {
  attack: AttackKind; // 'shot' = plain single bullet; 'arrow' = piercing, curving chain arrow (ArrowSystem); 'daggers' = quick burst of light daggers at 1-3 enemies; 'sword' = melee swing along the attack-cone arc (SwordSwingSystem); 'spear' = long, heavy thrust that pierces everything on its line (SpearSystem)
  fireRateMs: number;
  damage: number;
  range: number;
  bulletSpeed: number;
  moveResponseRate: number; // per-second exponential catch-up rate toward its formation slot; kept fast so followers close the gap quickly once they start reacting — the human "not a drone" delay lives entirely in the one-time start-move reaction pause (FOLLOWER_START_MOVE_DELAY_SEC), not in an ongoing lag
  attackConeDeg: number; // width of the firing arc around aimDirection each shot picks within
}

export const DEFAULT_STATS: CharacterStats = {
  attack: 'shot',
  fireRateMs: 450,
  damage: 10,
  range: 240,
  bulletSpeed: 460,
  moveResponseRate: 8, // time constant ~0.125s; ~95% of the way there in under half a second
  attackConeDeg: 90,
};

export const AIM_INDICATOR_LENGTH = 112;
const AIM_INDICATOR_BAND_COUNT = 8; // concentric pie slices whose overlap simulates a center-to-edge fade
const AIM_INDICATOR_BAND_ALPHA = 0.035; // per-layer alpha; compounds toward the center, thins out toward the tip
const AIM_INDICATOR_EDGE_ALPHA = 0.32;
// Ground-level overlay: a fixed depth above the background and formation links (4) but far below
// every Y-sorted character/enemy (Y_SORT_DEPTH_OFFSET + y), so no cone ever draws over a body.
const AIM_INDICATOR_DEPTH = 5;
const HEALTH_BAR_WIDTH = 44; // roughly the sprite's own width, so neighbors ~spacing (50px) apart don't overlap much
const HEALTH_BAR_HEIGHT = 6;
const COOLDOWN_BAR_WIDTH = 32; // narrower and thinner than the health bar it hangs under
const COOLDOWN_BAR_HEIGHT = 3;
const COOLDOWN_BAR_GAP = 2;
const COOLDOWN_BAR_COLOR = 0xfacc15;
const DAMAGE_FLASH_DURATION_MS = 100;
const DAMAGE_FLASH_MIN_INTERVAL_MS = 250; // contact damage ticks every frame; without this the sprite would stay solid white instead of pulsing
const SPRITE_SCALE = CHARACTER_DISPLAY_HEIGHT / CHARACTER_FRAME_HEIGHT;
const MOVEMENT_TURN_RATE_RAD_PER_SEC = Math.PI * 3; // how fast facingAngle catches up to actual movement
const LEADER_ARROW_TIP_DISTANCE = AIM_INDICATOR_LENGTH + 40; // floats clear beyond the attack-cone indicator so the two never crowd each other
const LEADER_ARROW_ARM_LENGTH = 22;
const LEADER_ARROW_SPREAD_RAD = Math.PI / 5; // how open the ">" chevron is
const LEADER_ARROW_COLOR = 0x22d3ee;
const LEADER_ARROW_OUTLINE_COLOR = 0x0f172a;
const FOLLOWER_START_MOVE_DELAY_SEC = 0.2; // human reaction-time pause before a follower reacts to the squad setting off from a standstill
const LEADER_MOVE_RESPONSE_RATE = 20; // ~0.05s time constant — the player's own input should feel immediate, not eased like the followers

// Y-sort: depth tracks the sprite's foot position (its lower edge, not its center) every frame,
// so a character standing further down the screen — visually closer to the viewer — always
// renders in front of one standing further up, and the ordering updates live as either moves.
// Offset well clear of zero so it stays positive (and thus in front of the background/formation
// links) even when world Y goes negative, which it can in this unbounded world. Overlays (health bar,
// leader arrow) are pinned to the same base so the whole per-character stack sorts
// as one unit instead of interleaving with a neighbor's.
export const Y_SORT_DEPTH_OFFSET = 100_000;

function footDepth(sprite: Phaser.GameObjects.Sprite): number {
  return Y_SORT_DEPTH_OFFSET + sprite.y + sprite.displayHeight / 2;
}

export class Character {
  sprite: Phaser.Physics.Arcade.Sprite;
  stats: CharacterStats;
  maxHp = 30;
  hp = this.maxHp;
  aimDirection: Vec2 = { x: 1, y: 0 };
  level = 1;
  exp = 0; // gems collected toward the next level
  readonly isLeader: boolean;

  readonly tint: number; // the cone and its attacks take the character's own color so overlapping cones stay attributable
  private currentDirectionIndex = -1;
  private facingAngle = 0; // smoothed; catches up to targetFacingAngle every frame, moving or not
  private targetFacingAngle = 0; // last direction actually moved toward; sticks once movement stops
  private aimIndicator: Phaser.GameObjects.Graphics;
  private healthBar: Phaser.GameObjects.Graphics;
  private leaderArrow: Phaser.GameObjects.Graphics | null = null;
  private lastFiredAt = -Infinity;
  private flashUntil = 0;
  private lastFlashAt = -Infinity;
  private holdRemaining = 0; // followers only; holds position (moveToward is a no-op) while > 0 — see triggerStartMoveDelay

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    tint: number,
    stats: Partial<CharacterStats> = {},
    isLeader = false,
  ) {
    this.stats = { ...DEFAULT_STATS, ...stats };
    this.isLeader = isLeader;
    this.tint = tint;
    this.sprite = scene.physics.add.sprite(x, y, CHARACTER_TEXTURE);
    this.sprite.setScale(SPRITE_SCALE);
    this.sprite.setTint(tint);
    this.playDirectionForAim();
    this.aimIndicator = scene.add.graphics().setDepth(AIM_INDICATOR_DEPTH);
    this.healthBar = scene.add.graphics().setDepth(6);
    if (this.isLeader) this.leaderArrow = scene.add.graphics().setDepth(7);
  }

  /**
   * Followers only: called when the squad transitions from a standstill to moving, so they hold
   * position for a beat — a human reaction-time pause — before reacting, rather than setting off
   * in perfect lockstep with the leader like a drone.
   */
  triggerStartMoveDelay() {
    if (!this.isLeader) this.holdRemaining = Math.max(this.holdRemaining, FOLLOWER_START_MOVE_DELAY_SEC);
  }

  /**
   * Eases toward its formation slot with framerate-independent exponential smoothing (fraction
   * of the remaining gap closed this frame depends on elapsed time, not frame count).
   *
   * A formation shape/flip/size change deliberately gets no special-case delay of its own — it's
   * just a new target position, closed at the same normal rate as everything else, which is
   * already fast and continuous. Holding position or slowing the rate for it was tried and looked
   * like followers freezing/stunning, or jerking once a temporary slowdown expired; plain fast
   * easing has neither problem. The one intentional delay left is the start-move reaction pause
   * (holdRemaining, see triggerStartMoveDelay). The leader always uses its own much faster rate
   * and is never held.
   */
  moveToward(target: { x: number; y: number }, dt: number) {
    if (this.holdRemaining > 0) {
      this.holdRemaining -= dt;
      return;
    }

    const rate = this.isLeader ? LEADER_MOVE_RESPONSE_RATE : this.stats.moveResponseRate;
    const factor = 1 - Math.exp(-rate * dt);
    this.sprite.x += (target.x - this.sprite.x) * factor;
    this.sprite.y += (target.y - this.sprite.y) * factor;
  }

  /**
   * Leader-only: drives the movement-direction arrow (see drawLeaderArrow) from the raw input
   * direction directly — not a position-delta heuristic, which misses very brief key taps whose
   * accumulated displacement never exceeds a pixel threshold. Mirrors SquadFormation's
   * sticky-heading pattern: while a direction is held, the target tracks it directly; once
   * released, the target sticks and facingAngle keeps turning toward it every frame regardless,
   * so even a brief tap eventually finishes the turn instead of never registering at all.
   */
  updateMovementFacing(moveDir: Vec2, dt: number) {
    if (!this.isLeader) return;
    if (moveDir.x !== 0 || moveDir.y !== 0) {
      this.targetFacingAngle = Math.atan2(moveDir.y, moveDir.x);
    }
    this.facingAngle = rotateTowardAngle(this.facingAngle, this.targetFacingAngle, MOVEMENT_TURN_RATE_RAD_PER_SEC * dt);
  }

  /**
   * Sets where this slot is watching/firing, and keeps the displayed directional idle animation
   * in lock-step with it — the character always visually faces its attack angle, never its
   * movement direction. aimDirection already turns gradually (see SquadFormation's chain-follow),
   * so this doesn't need its own smoothing on top.
   */
  setAimDirection(dir: Vec2) {
    this.aimDirection = dir;
    this.playDirectionForAim();
  }

  private playDirectionForAim() {
    const directionIndex = angleToDirection8(Math.atan2(this.aimDirection.y, this.aimDirection.x));
    if (directionIndex === this.currentDirectionIndex) return;
    this.currentDirectionIndex = directionIndex;
    this.sprite.play(idleAnimKey(directionIndex));
  }

  /** Applies damage and, at most once per DAMAGE_FLASH_MIN_INTERVAL_MS, flashes the sprite solid white. */
  takeDamage(amount: number, timeMs: number) {
    this.hp -= amount;
    if (timeMs - this.lastFlashAt < DAMAGE_FLASH_MIN_INTERVAL_MS) return;
    this.lastFlashAt = timeMs;
    this.flashUntil = timeMs + DAMAGE_FLASH_DURATION_MS;
    this.sprite.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
  }

  /** Gems needed to go from the current level to the next. */
  get expToNext(): number {
    return 6 + 4 * (this.level - 1);
  }

  gainExp(amount: number) {
    this.exp += amount;
    while (this.exp >= this.expToNext) {
      this.exp -= this.expToNext;
      this.level += 1;
    }
  }

  /** 1 the instant it fires, draining to 0 (ready) as the fire-rate cooldown elapses. */
  getCooldownFraction(timeMs: number): number {
    return 1 - Phaser.Math.Clamp((timeMs - this.lastFiredAt) / this.stats.fireRateMs, 0, 1);
  }

  /** Where the attack cone (and melee swings) originate: the feet, per the measured sprite frame. */
  getGroundPosition(): Vec2 {
    const { x, y } = this.sprite;
    return { x, y: y + (frameFootRow(Number(this.sprite.frame.name)) - CHARACTER_FRAME_HEIGHT / 2) * SPRITE_SCALE };
  }

  canFire(timeMs: number): boolean {
    return timeMs - this.lastFiredAt >= this.stats.fireRateMs;
  }

  markFired(timeMs: number) {
    this.lastFiredAt = timeMs;
  }

  /** Redraws the aim-cone indicator (anchored at the sprite's feet), health gauge and attack-cooldown gauge. */
  updateVisuals(timeMs: number) {
    const { x, y } = this.sprite;

    if (this.flashUntil > 0 && timeMs >= this.flashUntil) {
      this.flashUntil = 0;
      this.sprite.setTint(this.tint).setTintMode(Phaser.TintModes.MULTIPLY);
    }

    const baseDepth = footDepth(this.sprite);
    this.sprite.setDepth(baseDepth);
    this.healthBar.setDepth(baseDepth + 1);
    this.leaderArrow?.setDepth(baseDepth + 2);

    const baseAngle = Math.atan2(this.aimDirection.y, this.aimDirection.x);
    const halfCone = Phaser.Math.DegToRad(this.stats.attackConeDeg) / 2;
    const startAngle = baseAngle - halfCone;
    const endAngle = baseAngle + halfCone;

    // The cone sits on the ground, so it fans out from the character's feet, not the sprite's center.
    const footY = this.getGroundPosition().y;
    const g = this.aimIndicator;
    g.clear();

    // Drawn outer-radius-first, each successive (smaller) slice overlaid on top: their alphas
    // compound near the feet and thin out toward the edge, faking a radial fade without a
    // gradient fill API.
    for (let i = AIM_INDICATOR_BAND_COUNT; i >= 1; i--) {
      const r = (AIM_INDICATOR_LENGTH * i) / AIM_INDICATOR_BAND_COUNT;
      g.fillStyle(this.tint, AIM_INDICATOR_BAND_ALPHA);
      g.beginPath();
      g.moveTo(x, footY);
      g.arc(x, footY, r, startAngle, endAngle, false);
      g.closePath();
      g.fillPath();
    }

    // Graphics.arc() after beginPath() doesn't reliably stroke the two radial edges (only the
    // curved rim), so the cone's boundaries are drawn explicitly. The edges are split into
    // segments whose alpha falls off toward the tip, so the outline fades with the fill instead
    // of ending in a hard line.
    const EDGE_SEGMENTS = 6;
    for (let i = 0; i < EDGE_SEGMENTS; i++) {
      const r0 = (AIM_INDICATOR_LENGTH * i) / EDGE_SEGMENTS;
      const r1 = (AIM_INDICATOR_LENGTH * (i + 1)) / EDGE_SEGMENTS;
      g.lineStyle(2, this.tint, AIM_INDICATOR_EDGE_ALPHA * (1 - (i / EDGE_SEGMENTS) * 0.7));
      for (const a of [startAngle, endAngle]) {
        g.lineBetween(x + Math.cos(a) * r0, footY + Math.sin(a) * r0, x + Math.cos(a) * r1, footY + Math.sin(a) * r1);
      }
    }

    const frac = Phaser.Math.Clamp(this.hp / this.maxHp, 0, 1);
    const barX = x - HEALTH_BAR_WIDTH / 2;
    const barY = y - this.sprite.displayHeight / 2 - 16;
    this.healthBar.clear();
    this.healthBar.fillStyle(0x000000, 0.5);
    this.healthBar.fillRect(barX - 1, barY - 1, HEALTH_BAR_WIDTH + 2, HEALTH_BAR_HEIGHT + 2);
    this.healthBar.fillStyle(0x2d3339, 1);
    this.healthBar.fillRect(barX, barY, HEALTH_BAR_WIDTH, HEALTH_BAR_HEIGHT);
    const barColor = frac > 0.5 ? 0x4ade80 : frac > 0.25 ? 0xfacc15 : 0xef4444;
    this.healthBar.fillStyle(barColor, 1);
    this.healthBar.fillRect(barX, barY, HEALTH_BAR_WIDTH * frac, HEALTH_BAR_HEIGHT);

    // Attack countdown: full the instant it fires, draining to empty as the fire-rate cooldown elapses.
    const cooldownFrac = this.getCooldownFraction(timeMs);
    const cooldownX = x - COOLDOWN_BAR_WIDTH / 2;
    const cooldownY = barY + HEALTH_BAR_HEIGHT + 1 + COOLDOWN_BAR_GAP;
    this.healthBar.fillStyle(0x000000, 0.5);
    this.healthBar.fillRect(cooldownX - 1, cooldownY - 1, COOLDOWN_BAR_WIDTH + 2, COOLDOWN_BAR_HEIGHT + 2);
    this.healthBar.fillStyle(0x2d3339, 1);
    this.healthBar.fillRect(cooldownX, cooldownY, COOLDOWN_BAR_WIDTH, COOLDOWN_BAR_HEIGHT);
    this.healthBar.fillStyle(COOLDOWN_BAR_COLOR, 1);
    this.healthBar.fillRect(cooldownX, cooldownY, COOLDOWN_BAR_WIDTH * cooldownFrac, COOLDOWN_BAR_HEIGHT);

    if (this.leaderArrow) this.drawLeaderArrow(x, footY, this.facingAngle);
  }

  /**
   * Leader-only ">" chevron sitting just past the tip of the attack-cone indicator, tracking
   * facingAngle (the direction updateMovementFacing() last actually turned this character to face) rather
   * than the attack angle — attack direction can be inverted by the shooting-direction flip (X),
   * so this marks the way the squad is actually walking, not where it's aiming.
   */
  private drawLeaderArrow(x: number, y: number, angle: number) {
    const arrow = this.leaderArrow!;
    arrow.clear();

    const tipX = x + Math.cos(angle) * LEADER_ARROW_TIP_DISTANCE;
    const tipY = y + Math.sin(angle) * LEADER_ARROW_TIP_DISTANCE;
    const backAngleLeft = angle - Math.PI + LEADER_ARROW_SPREAD_RAD;
    const backAngleRight = angle + Math.PI - LEADER_ARROW_SPREAD_RAD;
    const leftX = tipX + Math.cos(backAngleLeft) * LEADER_ARROW_ARM_LENGTH;
    const leftY = tipY + Math.sin(backAngleLeft) * LEADER_ARROW_ARM_LENGTH;
    const rightX = tipX + Math.cos(backAngleRight) * LEADER_ARROW_ARM_LENGTH;
    const rightY = tipY + Math.sin(backAngleRight) * LEADER_ARROW_ARM_LENGTH;

    // Dark outline first so the bright chevron still pops against the light attack-cone indicator and the ground tile.
    arrow.lineStyle(4, LEADER_ARROW_OUTLINE_COLOR, 0.9);
    arrow.lineBetween(tipX, tipY, leftX, leftY);
    arrow.lineBetween(tipX, tipY, rightX, rightY);

    arrow.lineStyle(2, LEADER_ARROW_COLOR, 1);
    arrow.lineBetween(tipX, tipY, leftX, leftY);
    arrow.lineBetween(tipX, tipY, rightX, rightY);
  }

  destroy() {
    this.sprite.destroy();
    this.aimIndicator.destroy();
    this.healthBar.destroy();
    this.leaderArrow?.destroy();
  }
}
