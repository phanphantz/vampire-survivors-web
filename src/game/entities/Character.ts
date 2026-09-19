import Phaser from 'phaser';
import { angleToDirection8 } from '../formation/Formation';
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

const AIM_INDICATOR_LENGTH = 56;
const HEALTH_BAR_WIDTH = 40;
const HEALTH_BAR_HEIGHT = 6;
const SPRITE_SCALE = CHARACTER_DISPLAY_HEIGHT / CHARACTER_FRAME_HEIGHT;

export class Character {
  sprite: Phaser.Physics.Arcade.Sprite;
  stats: CharacterStats;
  maxHp = 30;
  hp = this.maxHp;
  aimDirection: Vec2 = { x: 1, y: 0 };

  private currentDirectionIndex = -1;
  private aimIndicator: Phaser.GameObjects.Graphics;
  private healthBar: Phaser.GameObjects.Graphics;
  private lastFiredAt = -Infinity;

  constructor(scene: Phaser.Scene, x: number, y: number, tint: number, stats: Partial<CharacterStats> = {}) {
    this.stats = { ...DEFAULT_STATS, ...stats };
    this.sprite = scene.physics.add.sprite(x, y, CHARACTER_TEXTURE);
    this.sprite.setScale(SPRITE_SCALE);
    this.sprite.setTint(tint);
    this.playDirectionForAim();
    this.aimIndicator = scene.add.graphics().setDepth(5);
    this.healthBar = scene.add.graphics().setDepth(6);
  }

  /** Eases toward its formation slot. The sprite's facing is driven entirely by aimDirection (see setAimDirection), not movement. */
  moveToward(target: { x: number; y: number }) {
    this.sprite.x += (target.x - this.sprite.x) * this.stats.moveSmoothing;
    this.sprite.y += (target.y - this.sprite.y) * this.stats.moveSmoothing;
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
    const barY = y - this.sprite.displayHeight / 2 - 10;
    this.healthBar.clear();
    this.healthBar.fillStyle(0x000000, 0.5);
    this.healthBar.fillRect(barX - 1, barY - 1, HEALTH_BAR_WIDTH + 2, HEALTH_BAR_HEIGHT + 2);
    this.healthBar.fillStyle(0x2d3339, 1);
    this.healthBar.fillRect(barX, barY, HEALTH_BAR_WIDTH, HEALTH_BAR_HEIGHT);
    const barColor = frac > 0.5 ? 0x4ade80 : frac > 0.25 ? 0xfacc15 : 0xef4444;
    this.healthBar.fillStyle(barColor, 1);
    this.healthBar.fillRect(barX, barY, HEALTH_BAR_WIDTH * frac, HEALTH_BAR_HEIGHT);
  }

  destroy() {
    this.sprite.destroy();
    this.aimIndicator.destroy();
    this.healthBar.destroy();
  }
}
