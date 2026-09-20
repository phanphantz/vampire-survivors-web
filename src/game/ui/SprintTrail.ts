import Phaser from 'phaser';
import type { Character } from '../entities/Character';
import type { Vec2 } from '../formation/Formation';

const GHOST_INTERVAL_MS = 45; // spacing of afterimages while sprinting
const GHOST_LIFETIME_MS = 260;
const GHOST_ALPHA = 0.45;
const GHOST_TINT = 0xbfe9ff; // cool wash so the trail reads as speed, not as extra characters
const DUST_COUNT = 8;
const DUST_LIFETIME_MS = 320;
const DUST_COLOR = 0xe2e8f0;

/**
 * Visual feedback for sprinting: fading afterimages behind every squad member while running, and
 * a puff of dust kicked up behind the squad at the moment a dash begins. Purely cosmetic.
 */
export class SprintTrail {
  private scene: Phaser.Scene;
  private lastGhostAt = -Infinity;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  update(timeMs: number, isSprinting: boolean, squad: Character[]) {
    if (!isSprinting || timeMs - this.lastGhostAt < GHOST_INTERVAL_MS) return;
    this.lastGhostAt = timeMs;
    for (const character of squad) this.spawnGhost(character);
  }

  /** Dust burst thrown backward from the squad's feet; `heading` is the (normalized) run direction. */
  burst(squad: Character[], heading: Vec2) {
    for (const character of squad) {
      const foot = character.getGroundPosition();
      for (let i = 0; i < DUST_COUNT; i++) {
        const spread = (Math.random() - 0.5) * 1.4; // radians off straight-back
        const angle = Math.atan2(-heading.y, -heading.x) + spread;
        const dist = 30 + Math.random() * 40;
        const puff = this.scene.add
          .circle(foot.x, foot.y, 3 + Math.random() * 3, DUST_COLOR, 0.6)
          .setDepth(character.sprite.depth - 1);
        this.scene.tweens.add({
          targets: puff,
          x: foot.x + Math.cos(angle) * dist,
          y: foot.y + Math.sin(angle) * dist,
          scale: 2,
          alpha: 0,
          duration: DUST_LIFETIME_MS,
          ease: 'Cubic.easeOut',
          onComplete: () => puff.destroy(),
        });
      }
    }
  }

  private spawnGhost(character: Character) {
    const { sprite } = character;
    const ghost = this.scene.add
      .sprite(sprite.x, sprite.y, sprite.texture.key, sprite.frame.name)
      .setScale(sprite.scaleX, sprite.scaleY)
      .setTint(GHOST_TINT)
      .setAlpha(GHOST_ALPHA)
      .setDepth(sprite.depth - 1); // just behind the character it trails
    this.scene.tweens.add({
      targets: ghost,
      alpha: 0,
      duration: GHOST_LIFETIME_MS,
      onComplete: () => ghost.destroy(),
    });
  }
}
