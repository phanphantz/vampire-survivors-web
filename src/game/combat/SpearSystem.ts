import Phaser from 'phaser';

const EXTEND_SEC = 0.09;
const HOLD_SEC = 0.07;
const RETRACT_SEC = 0.14;
const SHAFT_START = 18; // the thrust emerges from just in front of the character, not from its center
const HIT_HALF_WIDTH = 10;
const ENEMY_HIT_PADDING = 12;
const HEAD_LENGTH = 22;
const HEAD_HALF_WIDTH = 8;

interface Thrust {
  getOrigin: () => { x: number; y: number } | null;
  angle: number;
  length: number;
  damage: number;
  color: number;
  elapsed: number;
  hit: Set<Phaser.GameObjects.GameObject>;
}

/**
 * Long, heavy spear: thrusts out along a fixed line, damaging every enemy on that line exactly
 * once as the tip passes through them, holds for a beat, then pulls back.
 */
export class SpearSystem {
  private thrusts: Thrust[] = [];
  private graphics: Phaser.GameObjects.Graphics;
  private getEnemies: () => Phaser.Physics.Arcade.Sprite[];
  private onHitEnemy: (enemy: Phaser.Physics.Arcade.Sprite, damage: number) => void;

  constructor(
    scene: Phaser.Scene,
    depth: number,
    getEnemies: () => Phaser.Physics.Arcade.Sprite[],
    onHitEnemy: (enemy: Phaser.Physics.Arcade.Sprite, damage: number) => void,
  ) {
    this.getEnemies = getEnemies;
    this.onHitEnemy = onHitEnemy;
    this.graphics = scene.add.graphics().setDepth(depth);
  }

  /** `getOrigin` is re-read every frame so the spear stays attached to the character; null cancels it. */
  thrust(getOrigin: () => { x: number; y: number } | null, angle: number, length: number, damage: number, color: number) {
    this.thrusts.push({ getOrigin, angle, length, damage, color, elapsed: 0, hit: new Set() });
  }

  update(dt: number) {
    this.graphics.clear();
    this.thrusts = this.thrusts.filter((thrust) => {
      thrust.elapsed += dt;
      const origin = thrust.getOrigin();
      if (!origin || thrust.elapsed >= EXTEND_SEC + HOLD_SEC + RETRACT_SEC) return false;
      this.step(thrust, origin);
      return true;
    });
  }

  private step(thrust: Thrust, origin: { x: number; y: number }) {
    const { elapsed } = thrust;
    let extension: number;
    if (elapsed < EXTEND_SEC) {
      const t = elapsed / EXTEND_SEC;
      extension = 1 - (1 - t) * (1 - t) * (1 - t); // shoots out fast, decelerating into full reach
    } else if (elapsed < EXTEND_SEC + HOLD_SEC) {
      extension = 1;
    } else {
      extension = 1 - (elapsed - EXTEND_SEC - HOLD_SEC) / RETRACT_SEC;
    }

    const dx = Math.cos(thrust.angle);
    const dy = Math.sin(thrust.angle);
    const tipDist = SHAFT_START + (thrust.length - SHAFT_START) * extension;

    if (elapsed < EXTEND_SEC + HOLD_SEC) {
      for (const enemy of this.getEnemies()) {
        if (!enemy.active || thrust.hit.has(enemy)) continue;
        const ex = enemy.x - origin.x;
        const ey = enemy.y - origin.y;
        const along = ex * dx + ey * dy;
        if (along < 0 || along > tipDist + ENEMY_HIT_PADDING) continue;
        if (Math.abs(-ex * dy + ey * dx) > HIT_HALF_WIDTH + ENEMY_HIT_PADDING) continue;
        thrust.hit.add(enemy);
        this.onHitEnemy(enemy, thrust.damage);
      }
    }

    const g = this.graphics;
    const startX = origin.x + dx * SHAFT_START;
    const startY = origin.y + dy * SHAFT_START;
    const tipX = origin.x + dx * tipDist;
    const tipY = origin.y + dy * tipDist;
    const fade = elapsed < EXTEND_SEC + HOLD_SEC ? 1 : extension;

    g.lineStyle(14, thrust.color, 0.25 * fade); // soft glow along the line of attack
    g.lineBetween(startX, startY, tipX, tipY);
    g.lineStyle(4, 0xcbb994, 1); // shaft
    g.lineBetween(startX, startY, tipX - dx * HEAD_LENGTH * 0.5, tipY - dy * HEAD_LENGTH * 0.5);
    g.fillStyle(0xffffff, 1); // spearhead
    g.fillTriangle(
      tipX + dx * HEAD_LENGTH * 0.5,
      tipY + dy * HEAD_LENGTH * 0.5,
      tipX - dx * HEAD_LENGTH * 0.5 - dy * HEAD_HALF_WIDTH,
      tipY - dy * HEAD_LENGTH * 0.5 + dx * HEAD_HALF_WIDTH,
      tipX - dx * HEAD_LENGTH * 0.5 + dy * HEAD_HALF_WIDTH,
      tipY - dy * HEAD_LENGTH * 0.5 - dx * HEAD_HALF_WIDTH,
    );
  }
}
