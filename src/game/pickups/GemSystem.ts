import Phaser from 'phaser';

export const GEM_TEXTURE = 'gem';

const GEM_COLLECT_RADIUS = 26;
const GEM_MAGNET_RADIUS = 120; // inside this, a gem starts drifting toward the nearest squad member
const GEM_MAGNET_MIN_SPEED = 80;
const GEM_MAGNET_MAX_SPEED = 620;
const GEMS_PER_CHUNK_MIN = 2;
const GEMS_PER_CHUNK_MAX = 6;

interface Gem {
  sprite: Phaser.GameObjects.Image;
  value: number;
}

/**
 * Collectible gems: scattered across the map as chunks become active, and dropped by dead
 * enemies. Every squad member is a collector — a gem near any of them is pulled in and picked up.
 */
export class GemSystem {
  private scene: Phaser.Scene;
  private depth: number;
  private gems: Gem[] = [];

  constructor(scene: Phaser.Scene, depth: number) {
    this.scene = scene;
    this.depth = depth;
  }

  get count(): number {
    return this.gems.length;
  }

  /** Drops a gem at (x, y); `popFrom` makes it hop out of a point (an enemy corpse) instead of just appearing. */
  spawn(x: number, y: number, value = 1, popFrom?: { x: number; y: number }) {
    const sprite = this.scene.add.image(x, y, GEM_TEXTURE).setDepth(this.depth);
    if (popFrom) {
      sprite.setPosition(popFrom.x, popFrom.y).setScale(0.3);
      this.scene.tweens.add({ targets: sprite, x, y, scaleX: 1, scaleY: 1, duration: 220, ease: 'Cubic.easeOut' });
    }
    this.gems.push({ sprite, value });
  }

  /** Scatters a random handful of gems across one world chunk (its top-left corner + size). */
  scatterChunk(chunkMinX: number, chunkMinY: number, chunkSize: number) {
    const n = Phaser.Math.Between(GEMS_PER_CHUNK_MIN, GEMS_PER_CHUNK_MAX);
    for (let i = 0; i < n; i++) {
      this.spawn(chunkMinX + Math.random() * chunkSize, chunkMinY + Math.random() * chunkSize);
    }
  }

  /**
   * Pulls gems toward the nearest collector and picks them up. `onCollect` receives the index of
   * the collector that got the gem, so whoever grabs it earns the credit.
   */
  update(dt: number, collectors: { x: number; y: number }[], onCollect: (collectorIndex: number, value: number) => void) {
    if (collectors.length === 0) return;
    this.gems = this.gems.filter((gem) => {
      const { sprite } = gem;
      let nearestIndex = 0;
      let nearestDist = Infinity;
      collectors.forEach((c, i) => {
        const d = Phaser.Math.Distance.Between(sprite.x, sprite.y, c.x, c.y);
        if (d < nearestDist) {
          nearestDist = d;
          nearestIndex = i;
        }
      });
      const nearest = collectors[nearestIndex];

      if (nearestDist <= GEM_COLLECT_RADIUS) {
        this.scene.tweens.killTweensOf(sprite);
        sprite.destroy();
        onCollect(nearestIndex, gem.value);
        return false;
      }
      if (nearestDist <= GEM_MAGNET_RADIUS) {
        this.scene.tweens.killTweensOf(sprite); // the magnet takes over from any drop-pop tween
        const pull = 1 - nearestDist / GEM_MAGNET_RADIUS;
        const step = Math.min((GEM_MAGNET_MIN_SPEED + pull * (GEM_MAGNET_MAX_SPEED - GEM_MAGNET_MIN_SPEED)) * dt, nearestDist);
        sprite.x += ((nearest.x - sprite.x) / nearestDist) * step;
        sprite.y += ((nearest.y - sprite.y) / nearestDist) * step;
      }
      return true;
    });
  }

  /** Drops gems that have left the simulated area (they respawn if their chunk is rediscovered). */
  cull(isActive: (pos: { x: number; y: number }) => boolean) {
    this.gems = this.gems.filter((gem) => {
      if (isActive(gem.sprite)) return true;
      this.scene.tweens.killTweensOf(gem.sprite);
      gem.sprite.destroy();
      return false;
    });
  }
}
