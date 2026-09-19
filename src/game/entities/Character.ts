import Phaser from 'phaser';
import { angleToDirection8, rotateTowardAngle } from '../formation/Formation';
import type { Vec2 } from '../formation/Formation';
import { CHARACTER_DISPLAY_HEIGHT, CHARACTER_FRAME_HEIGHT, CHARACTER_TEXTURE, idleAnimKey } from '../scenes/BootScene';

export interface CharacterStats {
  fireRateMs: number;
  damage: number;
  range: number;
  bulletSpeed: number;
  moveSmoothing: number; // fraction of the gap to the target slot closed per frame
  attackConeDeg: number; // width of the firing arc around aimDirection each shot picks within
}

export const DEFAULT_STATS: CharacterStats = {
  fireRateMs: 450,
  damage: 10,
  range: 240,
  bulletSpeed: 460,
  moveSmoothing: 0.18,
  attackConeDeg: 90,
};

const AIM_INDICATOR_LENGTH = 112;
const HEALTH_BAR_WIDTH = 80;
const HEALTH_BAR_HEIGHT = 9;
const SPRITE_SCALE = CHARACTER_DISPLAY_HEIGHT / CHARACTER_FRAME_HEIGHT;
const MOVEMENT_ARROW_OFFSET = 52; // px above the sprite's head, clear of the health bar
const MOVEMENT_ARROW_LENGTH = 28;
const MOVEMENT_ARROW_HEAD_SIZE = 12;
const MOVEMENT_ARROW_HEAD_SPREAD_RAD = Math.PI / 6;
const MOVEMENT_ARROW_COLOR = 0xfacc15;
const MOVEMENT_TURN_RATE_RAD_PER_SEC = Math.PI * 3;
const MIN_MOVE_DIST_FOR_TURN = 0.5; // px; ignore jitter when basically at the target already

export class Character {
  sprite: Phaser.Physics.Arcade.Sprite;
  stats: CharacterStats;
  maxHp = 30;
  hp = this.maxHp;
  aimDirection: Vec2 = { x: 1, y: 0 };
  readonly isLeader: boolean;

  private currentDirectionIndex = -1;
  private facingAngle = 0; // last direction moveToward() actually turned toward; holds while stationary
  private aimIndicator: Phaser.GameObjects.Graphics;
  private healthBar: Phaser.GameObjects.Graphics;
  private movementArrow: Phaser.GameObjects.Graphics | null = null;
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
    this.aimIndicator = scene.add.graphics().setDepth(5);
    this.healthBar = scene.add.graphics().setDepth(6);
    if (this.isLeader) this.movementArrow = scene.add.graphics().setDepth(7);
  }

  /**
   * Eases toward its formation slot. The sprite's own facing is driven entirely by aimDirection
   * (see setAimDirection), not movement — but facingAngle is still tracked here purely for the
   * leader's movement-direction arrow (see drawMovementArrow).
   */
  moveToward(target: { x: number; y: number }, dt: number) {
    const dx = (target.x - this.sprite.x) * this.stats.moveSmoothing;
    const dy = (target.y - this.sprite.y) * this.stats.moveSmoothing;
    this.sprite.x += dx;
    this.sprite.y += dy;

    if (this.isLeader && Math.hypot(dx, dy) > MIN_MOVE_DIST_FOR_TURN) {
      const targetAngle = Math.atan2(dy, dx);
      this.facingAngle = rotateTowardAngle(this.facingAngle, targetAngle, MOVEMENT_TURN_RATE_RAD_PER_SEC * dt);
    }
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

    const baseAngle = Math.atan2(this.aimDirection.y, this.aimDirection.x);
    const halfCone = Phaser.Math.DegToRad(this.stats.attackConeDeg) / 2;

    this.aimIndicator.clear();
    this.aimIndicator.fillStyle(0xffffff, 0.1);
    this.aimIndicator.lineStyle(1.5, 0xffffff, 0.4);
    this.aimIndicator.beginPath();
    this.aimIndicator.moveTo(x, y);
    this.aimIndicator.arc(x, y, AIM_INDICATOR_LENGTH, baseAngle - halfCone, baseAngle + halfCone, false);
    this.aimIndicator.closePath();
    this.aimIndicator.fillPath();
    this.aimIndicator.strokePath();

    this.aimIndicator.lineStyle(2, 0xffffff, 0.6);
    const tipX = x + this.aimDirection.x * AIM_INDICATOR_LENGTH;
    const tipY = y + this.aimDirection.y * AIM_INDICATOR_LENGTH;
    this.aimIndicator.lineBetween(x, y, tipX, tipY);

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

    if (this.movementArrow) this.drawMovementArrow(x, barY);
  }

  /**
   * Leader-only chevron, floating above the health bar, pointing along facingAngle — the
   * direction moveToward() last actually turned this character to face, which (unlike
   * aimDirection) keeps pointing the way the squad was last walked even after it stops.
   */
  private drawMovementArrow(x: number, healthBarY: number) {
    const arrow = this.movementArrow!;
    arrow.clear();

    const originY = healthBarY - MOVEMENT_ARROW_OFFSET;
    const angle = this.facingAngle;
    const tipX = x + Math.cos(angle) * MOVEMENT_ARROW_LENGTH;
    const tipY = originY + Math.sin(angle) * MOVEMENT_ARROW_LENGTH;

    arrow.lineStyle(2, MOVEMENT_ARROW_COLOR, 0.9);
    arrow.lineBetween(x, originY, tipX, tipY);

    const leftX = tipX - Math.cos(angle - MOVEMENT_ARROW_HEAD_SPREAD_RAD) * MOVEMENT_ARROW_HEAD_SIZE;
    const leftY = tipY - Math.sin(angle - MOVEMENT_ARROW_HEAD_SPREAD_RAD) * MOVEMENT_ARROW_HEAD_SIZE;
    const rightX = tipX - Math.cos(angle + MOVEMENT_ARROW_HEAD_SPREAD_RAD) * MOVEMENT_ARROW_HEAD_SIZE;
    const rightY = tipY - Math.sin(angle + MOVEMENT_ARROW_HEAD_SPREAD_RAD) * MOVEMENT_ARROW_HEAD_SIZE;

    arrow.fillStyle(MOVEMENT_ARROW_COLOR, 0.9);
    arrow.beginPath();
    arrow.moveTo(tipX, tipY);
    arrow.lineTo(leftX, leftY);
    arrow.lineTo(rightX, rightY);
    arrow.closePath();
    arrow.fillPath();
  }

  destroy() {
    this.sprite.destroy();
    this.aimIndicator.destroy();
    this.healthBar.destroy();
    this.movementArrow?.destroy();
  }
}
