import Phaser from 'phaser';
import type { Vec2 } from '../formation/Formation';

export interface CharacterStats {
  fireRateMs: number;
  damage: number;
  range: number;
  bulletSpeed: number;
  moveSmoothing: number; // fraction of the gap to the target slot closed per frame
}

export const DEFAULT_STATS: CharacterStats = {
  fireRateMs: 450,
  damage: 10,
  range: 240,
  bulletSpeed: 460,
  moveSmoothing: 0.18,
};

const AIM_INDICATOR_LENGTH = 34;
const HEALTH_BAR_WIDTH = 26;
const HEALTH_BAR_HEIGHT = 5;

export class Character {
  sprite: Phaser.Physics.Arcade.Sprite;
  stats: CharacterStats;
  maxHp = 30;
  hp = this.maxHp;
  aimDirection: Vec2 = { x: 1, y: 0 };

  private aimIndicator: Phaser.GameObjects.Graphics;
  private healthBar: Phaser.GameObjects.Graphics;
  private lastFiredAt = -Infinity;

  constructor(scene: Phaser.Scene, x: number, y: number, textureKey: string, stats: Partial<CharacterStats> = {}) {
    this.stats = { ...DEFAULT_STATS, ...stats };
    this.sprite = scene.physics.add.sprite(x, y, textureKey);
    this.aimIndicator = scene.add.graphics().setDepth(5);
    this.healthBar = scene.add.graphics().setDepth(6);
  }

  moveToward(target: { x: number; y: number }) {
    this.sprite.x += (target.x - this.sprite.x) * this.stats.moveSmoothing;
    this.sprite.y += (target.y - this.sprite.y) * this.stats.moveSmoothing;
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

  /** Redraws the aim-direction indicator and health gauge at the sprite's current position. */
  updateVisuals() {
    const { x, y } = this.sprite;

    this.aimIndicator.clear();
    this.aimIndicator.lineStyle(2, 0xffffff, 0.55);
    const tipX = x + this.aimDirection.x * AIM_INDICATOR_LENGTH;
    const tipY = y + this.aimDirection.y * AIM_INDICATOR_LENGTH;
    this.aimIndicator.lineBetween(x, y, tipX, tipY);
    this.aimIndicator.fillStyle(0xffffff, 0.55);
    this.aimIndicator.fillCircle(tipX, tipY, 3);

    const frac = Phaser.Math.Clamp(this.hp / this.maxHp, 0, 1);
    const barX = x - HEALTH_BAR_WIDTH / 2;
    const barY = y - this.sprite.height / 2 - 10;
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
