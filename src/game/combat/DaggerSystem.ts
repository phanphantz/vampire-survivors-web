import Phaser from 'phaser';

const MIN_FLIGHT_SEC = 0.2;
const MAX_FLIGHT_SEC = 0.45;
const DAGGER_SPEED = 620; // px/sec along the chord, used to time the flight
const TRAIL_LIFE_SEC = 0.18;
const BLADE_LENGTH = 16;
const BLADE_HALF_WIDTH = 4;
const GRIP_LENGTH = 7;

interface Dagger {
  getOrigin: () => { x: number; y: number } | null;
  target: Phaser.Physics.Arcade.Sprite;
  damage: number;
  color: number;
  delay: number; // seconds until it leaves the hand — staggers a burst
  side: 1 | -1; // which way the throw bows out before curving in
  bow: number; // how far the flight arcs out, as a fraction of the distance to the target
  started: boolean;
  duration: number;
  elapsed: number;
  start: { x: number; y: number };
  control: { x: number; y: number };
  lastEnd: { x: number; y: number }; // where the target was last seen, in case it dies mid-flight
  trail: { x: number; y: number; age: number }[];
}

/**
 * Thrown daggers: each flies a simple curved arc (a quadratic Bezier bowed out to one side) from
 * the thrower to its own target, like a knife lobbed with some spin on it rather than a laser-
 * straight bolt. The arc's far end keeps tracking the target, so it still lands on a moving enemy.
 */
export class DaggerSystem {
  private daggers: Dagger[] = [];
  private graphics: Phaser.GameObjects.Graphics;
  private onHitEnemy: (enemy: Phaser.Physics.Arcade.Sprite, damage: number) => void;

  constructor(scene: Phaser.Scene, depth: number, onHitEnemy: (enemy: Phaser.Physics.Arcade.Sprite, damage: number) => void) {
    this.onHitEnemy = onHitEnemy;
    this.graphics = scene.add.graphics().setDepth(depth);
  }

  throwDagger(
    getOrigin: () => { x: number; y: number } | null,
    target: Phaser.Physics.Arcade.Sprite,
    damage: number,
    color: number,
    delaySec: number,
    side: 1 | -1,
    bow: number,
  ) {
    this.daggers.push({
      getOrigin,
      target,
      damage,
      color,
      delay: delaySec,
      side,
      bow,
      started: false,
      duration: MIN_FLIGHT_SEC,
      elapsed: 0,
      start: { x: 0, y: 0 },
      control: { x: 0, y: 0 },
      lastEnd: { x: target.x, y: target.y },
      trail: [],
    });
  }

  update(dt: number) {
    this.graphics.clear();
    this.daggers = this.daggers.filter((dagger) => this.step(dagger, dt));
  }

  /** Returns false once the dagger has landed (or been cancelled) and its trail has faded. */
  private step(dagger: Dagger, dt: number): boolean {
    for (const point of dagger.trail) point.age += dt;
    while (dagger.trail.length > 0 && dagger.trail[0].age > TRAIL_LIFE_SEC) dagger.trail.shift();

    if (!dagger.started) {
      dagger.delay -= dt;
      if (dagger.delay > 0) return true;
      const origin = dagger.getOrigin();
      if (!origin || !dagger.target.active) return false;
      this.launch(dagger, origin);
    }

    if (dagger.elapsed >= dagger.duration) {
      this.drawTrail(dagger);
      return dagger.trail.length > 0;
    }

    if (dagger.target.active) {
      dagger.lastEnd.x = dagger.target.x;
      dagger.lastEnd.y = dagger.target.y;
    }
    dagger.elapsed = Math.min(dagger.elapsed + dt, dagger.duration);
    const t = dagger.elapsed / dagger.duration;
    const pos = bezier(dagger.start, dagger.control, dagger.lastEnd, t);
    dagger.trail.push({ x: pos.x, y: pos.y, age: 0 });

    if (t >= 1) {
      if (dagger.target.active) this.onHitEnemy(dagger.target, dagger.damage);
    } else {
      const ahead = bezier(dagger.start, dagger.control, dagger.lastEnd, Math.min(t + 0.03, 1));
      this.drawDagger(dagger, pos, Math.atan2(ahead.y - pos.y, ahead.x - pos.x));
    }
    this.drawTrail(dagger);
    return true;
  }

  private launch(dagger: Dagger, origin: { x: number; y: number }) {
    dagger.started = true;
    dagger.start = { x: origin.x, y: origin.y };
    const end = { x: dagger.target.x, y: dagger.target.y };
    const dx = end.x - origin.x;
    const dy = end.y - origin.y;
    const dist = Math.hypot(dx, dy) || 1;
    dagger.control = {
      x: (origin.x + end.x) / 2 - (dy / dist) * dist * dagger.bow * dagger.side,
      y: (origin.y + end.y) / 2 + (dx / dist) * dist * dagger.bow * dagger.side,
    };
    dagger.duration = Phaser.Math.Clamp(dist / DAGGER_SPEED, MIN_FLIGHT_SEC, MAX_FLIGHT_SEC);
    dagger.lastEnd = end;
  }

  private drawTrail(dagger: Dagger) {
    const g = this.graphics;
    for (let i = 1; i < dagger.trail.length; i++) {
      const a = dagger.trail[i - 1];
      const b = dagger.trail[i];
      const life = 1 - b.age / TRAIL_LIFE_SEC;
      g.lineStyle(1 + 2 * life, dagger.color, 0.6 * life);
      g.lineBetween(a.x, a.y, b.x, b.y);
    }
  }

  private drawDagger(dagger: Dagger, pos: { x: number; y: number }, angle: number) {
    const g = this.graphics;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    g.lineStyle(3, 0x9ca3af, 1); // grip
    g.lineBetween(pos.x - dx * GRIP_LENGTH, pos.y - dy * GRIP_LENGTH, pos.x, pos.y);
    g.fillStyle(0xffffff, 1); // blade
    g.fillTriangle(
      pos.x + dx * BLADE_LENGTH,
      pos.y + dy * BLADE_LENGTH,
      pos.x - dy * BLADE_HALF_WIDTH,
      pos.y + dx * BLADE_HALF_WIDTH,
      pos.x + dy * BLADE_HALF_WIDTH,
      pos.y - dx * BLADE_HALF_WIDTH,
    );
    g.lineStyle(1.5, dagger.color, 1);
    g.strokeTriangle(
      pos.x + dx * BLADE_LENGTH,
      pos.y + dy * BLADE_LENGTH,
      pos.x - dy * BLADE_HALF_WIDTH,
      pos.y + dx * BLADE_HALF_WIDTH,
      pos.x + dy * BLADE_HALF_WIDTH,
      pos.y - dx * BLADE_HALF_WIDTH,
    );
  }
}

function bezier(p0: { x: number; y: number }, c: { x: number; y: number }, p1: { x: number; y: number }, t: number) {
  const u = 1 - t;
  return { x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x, y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y };
}
