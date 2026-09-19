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

const AIM_INDICATOR_LENGTH = 40;
const HEALTH_BAR_WIDTH = 32;
const HEALTH_BAR_HEIGHT = 5;
const TURN_RATE_RAD_PER_SEC = Math.PI * 3; // faces its current running direction, not instantly
const MIN_MOVE_DIST_FOR_TURN = 0.5; // px; ignore jitter when basically at the target already
const SPRITE_SCALE = CHARACTER_DISPLAY_HEIGHT / CHARACTER_FRAME_HEIGHT;
const MOVEMENT_ARROW_OFFSET = 26; // px above the sprite's head, clear of the health bar
const MOVEMENT_ARROW_LENGTH = 14;
const MOVEMENT_ARROW_HEAD_SIZE = 6;
const MOVEMENT_ARROW_HEAD_SPREAD_RAD = Math.PI / 6;
const MOVEMENT_ARROW_COLOR = 0xfacc15;

export class Character {
  sprite: Phaser.Physics.Arcade.Sprite;
  stats: CharacterStats;
  maxHp = 30;
  hp = this.maxHp;
  aimDirection: Vec2 = { x: 1, y: 0 };
  readonly isLeader: boolean;

  private facingAngle = Math.PI / 2; // radians; drives which of the 8 idle animations plays, not sprite.rotation
  private currentDirectionIndex = -1;
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
    this.playDirection(angleToDirection8(this.facingAngle));
    this.aimIndicator = scene.add.graphics().setDepth(5);
    this.healthBar = scene.add.graphics().setDepth(6);
    if (this.isLeader) this.movementArrow = scene.add.graphics().setDepth(7);
  }

  /**
   * Eases toward its formation slot and turns to face the direction it's currently running,
   * gradually. The sprite itself is never rotated (it's pre-rendered 8-directional art, not a
   * shape) — instead this picks which directional idle animation to play.
   */
  moveToward(target: { x: number; y: number }, dt: number) {
    const dx = (target.x - this.sprite.x) * this.stats.moveSmoothing;
    const dy = (target.y - this.sprite.y) * this.stats.moveSmoothing;
    this.sprite.x += dx;
    this.sprite.y += dy;

    if (Math.hypot(dx, dy) > MIN_MOVE_DIST_FOR_TURN) {
      const targetAngle = Math.atan2(dy, dx);
      this.facingAngle = rotateTowardAngle(this.facingAngle, targetAngle, TURN_RATE_RAD_PER_SEC * dt);
      this.playDirection(angleToDirection8(this.facingAngle));
    }
  }

  private playDirection(directionIndex: number) {
    if (directionIndex === this.currentDirectionIndex) return;
    this.currentDirectionIndex = directionIndex;
    this.sprite.play(idleAnimKey(directionIndex));
  }

  setAimDirection(dir: Vec2) {
    this.aimDirection = dir;
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
    const barY = y - this.sprite.displayHeight / 2 - 10;
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
