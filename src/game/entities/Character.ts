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
const AIM_INDICATOR_BAND_COUNT = 8; // concentric pie slices whose overlap simulates a center-to-edge fade
const AIM_INDICATOR_BAND_ALPHA = 0.05; // per-layer alpha; compounds toward the center, thins out toward the tip
const HEALTH_BAR_WIDTH = 32;
const HEALTH_BAR_HEIGHT = 5;
const TURN_RATE_RAD_PER_SEC = Math.PI * 3; // faces its current running direction, not instantly
const MIN_MOVE_DIST_FOR_TURN = 0.5; // px; ignore jitter when basically at the target already
const SPRITE_SCALE = CHARACTER_DISPLAY_HEIGHT / CHARACTER_FRAME_HEIGHT;
const LEADER_ARROW_TIP_DISTANCE = AIM_INDICATOR_LENGTH + 6; // pokes past the attack-cone indicator so it reads in front of it
const LEADER_ARROW_ARM_LENGTH = 11;
const LEADER_ARROW_SPREAD_RAD = Math.PI / 5; // how open the ">" chevron is
const LEADER_ARROW_COLOR = 0x22d3ee;
const LEADER_ARROW_OUTLINE_COLOR = 0x0f172a;

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
    this.playDirection(angleToDirection8(this.facingAngle));
    this.aimIndicator = scene.add.graphics().setDepth(-1); // behind the sprite, not in front of it
    this.healthBar = scene.add.graphics().setDepth(6);
    if (this.isLeader) this.leaderArrow = scene.add.graphics().setDepth(7);
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

    if (this.leaderArrow) this.drawLeaderArrow(x, y, baseAngle);
  }

  /**
   * Leader-only ">" chevron sitting just past the tip of the attack-cone indicator, always at
   * the same angle as the cone (baseAngle) rather than the character's movement-facing angle —
   * it marks the attack direction, not the last way the squad walked.
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
