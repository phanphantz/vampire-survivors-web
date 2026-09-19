import Phaser from 'phaser';
import { angleToDirection8, rotateTowardAngle } from '../formation/Formation';
import type { Vec2 } from '../formation/Formation';
import { CHARACTER_DISPLAY_HEIGHT, CHARACTER_FRAME_HEIGHT, CHARACTER_TEXTURE, idleAnimKey } from '../scenes/BootScene';

export interface CharacterStats {
  fireRateMs: number;
  damage: number;
  range: number;
  bulletSpeed: number;
  moveSmoothing: number; // fraction of the gap to the target slot closed per frame; lower = a more visible, human catch-up lag when the formation reshapes, rather than snapping into place instantly
  attackConeDeg: number; // width of the firing arc around aimDirection each shot picks within
}

export const DEFAULT_STATS: CharacterStats = {
  fireRateMs: 450,
  damage: 10,
  range: 240,
  bulletSpeed: 460,
  moveSmoothing: 0.08,
  attackConeDeg: 90,
};

const AIM_INDICATOR_LENGTH = 112;
const AIM_INDICATOR_BAND_COUNT = 8; // concentric pie slices whose overlap simulates a center-to-edge fade
const AIM_INDICATOR_BAND_ALPHA = 0.05; // per-layer alpha; compounds toward the center, thins out toward the tip
const HEALTH_BAR_WIDTH = 80;
const HEALTH_BAR_HEIGHT = 9;
const SPRITE_SCALE = CHARACTER_DISPLAY_HEIGHT / CHARACTER_FRAME_HEIGHT;
const MOVEMENT_TURN_RATE_RAD_PER_SEC = Math.PI * 3; // how fast facingAngle catches up to actual movement
const LEADER_ARROW_TIP_DISTANCE = AIM_INDICATOR_LENGTH + 6; // pokes past the attack-cone indicator so it reads in front of it
const LEADER_ARROW_ARM_LENGTH = 22;
const LEADER_ARROW_SPREAD_RAD = Math.PI / 5; // how open the ">" chevron is
const LEADER_ARROW_COLOR = 0x22d3ee;
const LEADER_ARROW_OUTLINE_COLOR = 0x0f172a;

// Y-sort: depth tracks the sprite's foot position (its lower edge, not its center) every frame,
// so a character standing further down the screen — visually closer to the viewer — always
// renders in front of one standing further up, and the ordering updates live as either moves.
// Offset well clear of zero so it stays positive (and thus in front of the background/formation
// links) even when world Y goes negative, which it can in this unbounded world. Overlays (cone,
// health bar, leader arrow) are pinned to the same base so the whole per-character stack sorts
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
  readonly isLeader: boolean;

  private currentDirectionIndex = -1;
  private facingAngle = 0; // smoothed; catches up to targetFacingAngle every frame, moving or not
  private targetFacingAngle = 0; // last direction actually moved toward; sticks once movement stops
  private aimIndicator: Phaser.GameObjects.Graphics;
  private healthBar: Phaser.GameObjects.Graphics;
  private leaderArrow: Phaser.GameObjects.Graphics | null = null;
  private lastFiredAt = -Infinity;

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
    this.sprite = scene.physics.add.sprite(x, y, CHARACTER_TEXTURE);
    this.sprite.setScale(SPRITE_SCALE);
    this.sprite.setTint(tint);
    this.playDirectionForAim();
    this.aimIndicator = scene.add.graphics().setDepth(-1); // behind the sprite, not in front of it
    this.healthBar = scene.add.graphics().setDepth(6);
    if (this.isLeader) this.leaderArrow = scene.add.graphics().setDepth(7);
  }

  /** Eases toward its formation slot. The sprite's own facing is driven entirely by aimDirection (see setAimDirection), not movement. */
  moveToward(target: { x: number; y: number }) {
    this.sprite.x += (target.x - this.sprite.x) * this.stats.moveSmoothing;
    this.sprite.y += (target.y - this.sprite.y) * this.stats.moveSmoothing;
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

  canFire(timeMs: number): boolean {
    return timeMs - this.lastFiredAt >= this.stats.fireRateMs;
  }

  markFired(timeMs: number) {
    this.lastFiredAt = timeMs;
  }

  /** Redraws the aim-cone indicator and health gauge at the sprite's current position. */
  updateVisuals() {
    const { x, y } = this.sprite;

    const baseDepth = footDepth(this.sprite);
    this.aimIndicator.setDepth(baseDepth - 2);
    this.sprite.setDepth(baseDepth);
    this.healthBar.setDepth(baseDepth + 1);
    this.leaderArrow?.setDepth(baseDepth + 2);

    const baseAngle = Math.atan2(this.aimDirection.y, this.aimDirection.x);
    const halfCone = Phaser.Math.DegToRad(this.stats.attackConeDeg) / 2;

    this.aimIndicator.clear();

    // Drawn outer-radius-first, each successive (smaller) slice overlaid on top: their alphas
    // compound near the center and thin out toward the edge, faking a radial fade without a
    // gradient fill API.
    for (let i = AIM_INDICATOR_BAND_COUNT; i >= 1; i--) {
      const r = (AIM_INDICATOR_LENGTH * i) / AIM_INDICATOR_BAND_COUNT;
      this.aimIndicator.fillStyle(0xffffff, AIM_INDICATOR_BAND_ALPHA);
      this.aimIndicator.beginPath();
      this.aimIndicator.moveTo(x, y);
      this.aimIndicator.arc(x, y, r, baseAngle - halfCone, baseAngle + halfCone, false);
      this.aimIndicator.closePath();
      this.aimIndicator.fillPath();
    }

    // Graphics.arc() after beginPath() doesn't reliably stroke the two radial edges (only the
    // curved rim), so the cone's start/end boundaries are drawn explicitly as solid lines.
    this.aimIndicator.lineStyle(1.5, 0xffffff, 0.7);
    const startX = x + Math.cos(baseAngle - halfCone) * AIM_INDICATOR_LENGTH;
    const startY = y + Math.sin(baseAngle - halfCone) * AIM_INDICATOR_LENGTH;
    const endX = x + Math.cos(baseAngle + halfCone) * AIM_INDICATOR_LENGTH;
    const endY = y + Math.sin(baseAngle + halfCone) * AIM_INDICATOR_LENGTH;
    this.aimIndicator.lineBetween(x, y, startX, startY);
    this.aimIndicator.lineBetween(x, y, endX, endY);

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

    if (this.leaderArrow) this.drawLeaderArrow(x, y, this.facingAngle);
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
