import Phaser from 'phaser';
import { rotateTowardAngle } from '../formation/Formation';

const ARROW_SPEED = 520;
const ARROW_TURN_RATE_RAD_PER_SEC = Math.PI * 2.4; // limited turn rate is what makes the flight to the next target a curve instead of a snap
const ARROW_HIT_RADIUS = 18;
const CHAIN_RANGE = 220; // how far from the arrow's current position the next target may be
const MAX_CHAIN_TARGETS = 3; // extra enemies after the first one; each shot rolls 1..MAX
const MAX_TRAVEL = 1100;
const MAX_UNGUIDED_SEC = 0.35; // flies on straight this long once it has nobody left to chase
const TRAIL_LIFE_SEC = 0.35;
const TRAIL_MAX_WIDTH = 5;

interface Arrow {
  x: number;
  y: number;
  heading: number;
  color: number;
  damage: number;
  target: Phaser.Physics.Arcade.Sprite | null;
  targetsLeft: number; // enemies still to pass through, counting the current target
  hit: Set<Phaser.GameObjects.GameObject>;
  travelled: number;
  unguidedSec: number;
  trail: { x: number; y: number; age: number }[];
}

/**
 * The archer's shot: an arrow that pierces its nearest enemy, then curves on to the next 1-3
 * closest enemies in range, leaving a fading trail. Simulated by hand (no physics bodies) because
 * it steers toward targets and must pass through enemies instead of stopping on the first hit.
 */
export class ArrowSystem {
  private arrows: Arrow[] = [];
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

  fire(from: { x: number; y: number }, target: Phaser.Physics.Arcade.Sprite, damage: number, color: number) {
    this.arrows.push({
      x: from.x,
      y: from.y,
      heading: Math.atan2(target.y - from.y, target.x - from.x),
      color,
      damage,
      target,
      targetsLeft: 1 + Phaser.Math.Between(1, MAX_CHAIN_TARGETS),
      hit: new Set(),
      travelled: 0,
      unguidedSec: 0,
      trail: [],
    });
  }

  update(dt: number) {
    const g = this.graphics;
    g.clear();
    this.arrows = this.arrows.filter((arrow) => {
      const alive = this.step(arrow, dt);
      this.drawTrail(arrow);
      if (alive) this.drawHead(arrow);
      return alive || arrow.trail.length > 0; // a dead arrow lingers only until its trail has faded
    });
  }

  /** Advances one arrow; returns false once it is spent. */
  private step(arrow: Arrow, dt: number): boolean {
    for (const point of arrow.trail) point.age += dt;
    while (arrow.trail.length > 0 && arrow.trail[0].age > TRAIL_LIFE_SEC) arrow.trail.shift();
    if (arrow.travelled < 0) return false; // already spent; only the trail is left to fade

    if (arrow.target && !arrow.target.active) arrow.target = this.pickNext(arrow);

    if (arrow.target) {
      arrow.unguidedSec = 0;
      const desired = Math.atan2(arrow.target.y - arrow.y, arrow.target.x - arrow.x);
      arrow.heading = rotateTowardAngle(arrow.heading, desired, ARROW_TURN_RATE_RAD_PER_SEC * dt);
    } else {
      arrow.unguidedSec += dt;
    }

    arrow.x += Math.cos(arrow.heading) * ARROW_SPEED * dt;
    arrow.y += Math.sin(arrow.heading) * ARROW_SPEED * dt;
    arrow.travelled += ARROW_SPEED * dt;
    arrow.trail.push({ x: arrow.x, y: arrow.y, age: 0 });

    for (const enemy of this.getEnemies()) {
      if (!enemy.active || arrow.hit.has(enemy)) continue;
      if (Phaser.Math.Distance.Between(arrow.x, arrow.y, enemy.x, enemy.y) > ARROW_HIT_RADIUS) continue;
      arrow.hit.add(enemy);
      this.onHitEnemy(enemy, arrow.damage);
      if (enemy === arrow.target) {
        arrow.targetsLeft -= 1;
        arrow.target = arrow.targetsLeft > 0 ? this.pickNext(arrow) : null;
      }
    }

    const spent = arrow.travelled > MAX_TRAVEL || arrow.unguidedSec > MAX_UNGUIDED_SEC;
    if (spent) arrow.travelled = -1;
    return !spent;
  }

  private pickNext(arrow: Arrow): Phaser.Physics.Arcade.Sprite | null {
    let best: Phaser.Physics.Arcade.Sprite | null = null;
    let bestDist = CHAIN_RANGE;
    for (const enemy of this.getEnemies()) {
      if (!enemy.active || arrow.hit.has(enemy)) continue;
      const dist = Phaser.Math.Distance.Between(arrow.x, arrow.y, enemy.x, enemy.y);
      if (dist < bestDist) {
        bestDist = dist;
        best = enemy;
      }
    }
    return best;
  }

  private drawTrail(arrow: Arrow) {
    const g = this.graphics;
    for (let i = 1; i < arrow.trail.length; i++) {
      const a = arrow.trail[i - 1];
      const b = arrow.trail[i];
      const life = 1 - b.age / TRAIL_LIFE_SEC;
      g.lineStyle(1 + (TRAIL_MAX_WIDTH - 1) * life, arrow.color, 0.7 * life);
      g.lineBetween(a.x, a.y, b.x, b.y);
    }
  }

  private drawHead(arrow: Arrow) {
    const g = this.graphics;
    const dx = Math.cos(arrow.heading);
    const dy = Math.sin(arrow.heading);
    const tipX = arrow.x + dx * 9;
    const tipY = arrow.y + dy * 9;
    g.lineStyle(2, 0xffffff, 1);
    g.lineBetween(arrow.x - dx * 12, arrow.y - dy * 12, arrow.x, arrow.y);
    g.fillStyle(0xffffff, 1);
    g.fillTriangle(tipX, tipY, arrow.x - dy * 3.5, arrow.y + dx * 3.5, arrow.x + dy * 3.5, arrow.y - dx * 3.5);
  }
}
