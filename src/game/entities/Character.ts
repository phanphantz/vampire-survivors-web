import Phaser from 'phaser';

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

export class Character {
  sprite: Phaser.Physics.Arcade.Sprite;
  stats: CharacterStats;
  hp = 30;
  private lastFiredAt = -Infinity;

  constructor(scene: Phaser.Scene, x: number, y: number, textureKey: string, stats: Partial<CharacterStats> = {}) {
    this.stats = { ...DEFAULT_STATS, ...stats };
    this.sprite = scene.physics.add.sprite(x, y, textureKey);
  }

  moveToward(target: { x: number; y: number }) {
    this.sprite.x += (target.x - this.sprite.x) * this.stats.moveSmoothing;
    this.sprite.y += (target.y - this.sprite.y) * this.stats.moveSmoothing;
  }

  canFire(timeMs: number): boolean {
    return timeMs - this.lastFiredAt >= this.stats.fireRateMs;
  }

  markFired(timeMs: number) {
    this.lastFiredAt = timeMs;
  }

  destroy() {
    this.sprite.destroy();
  }
}
