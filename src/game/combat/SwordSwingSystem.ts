import Phaser from 'phaser';
import { angleDiff } from '../formation/Formation';

const SWING_DURATION_SEC = 0.22;
const SWING_INNER_RADIUS = 48; // starts out in front of the character rather than at its feet
const SWING_TRAIL_RAD = 1.4; // how far behind the blade the fading crescent extends
const ENEMY_HIT_PADDING = 14; // enemy body radius, so a swing catches enemies whose edge (not just center) is inside the arc
const ARC_STEPS = 14;

interface Swing {
  getOrigin: () => { x: number; y: number } | null;
  baseAngle: number;
  halfCone: number;
  reach: number;
  color: number;
  damage: number;
  elapsed: number;
  hit: Set<Phaser.GameObjects.GameObject>;
}

/**
 * Melee sword swing out in front of the character, centered on its attack angle: the blade sweeps a
 * wider arc than the attack cone, leaving a fading crescent, and damages each enemy the blade passes through once.
 */
export class SwordSwingSystem {
  private swings: Swing[] = [];
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

  /** `getOrigin` is re-read every frame so the swing stays attached to the character; null cancels it. */
  swing(getOrigin: () => { x: number; y: number } | null, baseAngle: number, sweepDeg: number, reach: number, damage: number, color: number) {
    this.swings.push({
      getOrigin,
      baseAngle,
      halfCone: Phaser.Math.DegToRad(sweepDeg) / 2,
      reach,
      color,
      damage,
      elapsed: 0,
      hit: new Set(),
    });
  }

  update(dt: number) {
    this.graphics.clear();
    this.swings = this.swings.filter((swing) => {
      swing.elapsed += dt;
      const origin = swing.getOrigin();
      if (!origin || swing.elapsed >= SWING_DURATION_SEC + 0.08) return false; // brief linger so the crescent fades out after the blade stops
      this.step(swing, origin);
      return true;
    });
  }

  private step(swing: Swing, origin: { x: number; y: number }) {
    const t = Math.min(swing.elapsed / SWING_DURATION_SEC, 1);
    const eased = 1 - (1 - t) * (1 - t); // fast start, settling finish — reads as a swing rather than a linear wipe
    const offset = -swing.halfCone + 2 * swing.halfCone * eased; // blade angle relative to the cone's center line
    const bladeAngle = swing.baseAngle + offset;

    if (t < 1 || swing.elapsed < SWING_DURATION_SEC + 0.01) {
      for (const enemy of this.getEnemies()) {
        if (!enemy.active || swing.hit.has(enemy)) continue;
        const dist = Phaser.Math.Distance.Between(origin.x, origin.y, enemy.x, enemy.y);
        if (dist > swing.reach + ENEMY_HIT_PADDING) continue;
        const rel = angleDiff(Math.atan2(enemy.y - origin.y, enemy.x - origin.x), swing.baseAngle);
        if (rel < -swing.halfCone || rel > offset) continue; // inside the cone, and already passed by the blade
        swing.hit.add(enemy);
        this.onHitEnemy(enemy, swing.damage);
      }
    }

    const fade = t < 1 ? 1 : Math.max(0, 1 - (swing.elapsed - SWING_DURATION_SEC) / 0.08);
    this.drawCrescent(swing, origin, offset, fade);
    if (t < 1) this.drawBlade(swing, origin, bladeAngle);
  }

  private drawCrescent(swing: Swing, origin: { x: number; y: number }, offset: number, fade: number) {
    const g = this.graphics;
    const from = Math.max(-swing.halfCone, offset - SWING_TRAIL_RAD);
    const slices = 4; // stacked slices, older ones dimmer, fake a fade along the trail
    for (let s = 0; s < slices; s++) {
      const a0 = from + ((offset - from) * s) / slices;
      const a1 = from + ((offset - from) * (s + 1)) / slices;
      const points: Phaser.Math.Vector2[] = [];
      for (let i = 0; i <= ARC_STEPS; i++) {
        const a = swing.baseAngle + a0 + ((a1 - a0) * i) / ARC_STEPS;
        points.push(new Phaser.Math.Vector2(origin.x + Math.cos(a) * swing.reach, origin.y + Math.sin(a) * swing.reach));
      }
      for (let i = ARC_STEPS; i >= 0; i--) {
        const a = swing.baseAngle + a0 + ((a1 - a0) * i) / ARC_STEPS;
        points.push(new Phaser.Math.Vector2(origin.x + Math.cos(a) * SWING_INNER_RADIUS, origin.y + Math.sin(a) * SWING_INNER_RADIUS));
      }
      g.fillStyle(swing.color, 0.5 * fade * ((s + 1) / slices));
      g.fillPoints(points, true);
    }
  }

  private drawBlade(swing: Swing, origin: { x: number; y: number }, angle: number) {
    const g = this.graphics;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    g.lineStyle(5, swing.color, 0.9);
    g.lineBetween(origin.x + dx * SWING_INNER_RADIUS, origin.y + dy * SWING_INNER_RADIUS, origin.x + dx * swing.reach, origin.y + dy * swing.reach);
    g.lineStyle(2, 0xffffff, 1);
    g.lineBetween(origin.x + dx * SWING_INNER_RADIUS, origin.y + dy * SWING_INNER_RADIUS, origin.x + dx * swing.reach, origin.y + dy * swing.reach);
  }
}
