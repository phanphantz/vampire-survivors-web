import Phaser from 'phaser';
import { SquadFormation } from '../formation/SquadFormation';
import { MAX_SQUAD_SIZE } from '../formation/Formation';
import type { Vec2 } from '../formation/Formation';
import { Character } from '../entities/Character';

const WORLD_WIDTH = 960;
const WORLD_HEIGHT = 600;
const SQUAD_MOVE_SPEED = 220; // px/sec
const ENEMY_BASE_SPEED = 70;
const ENEMY_BASE_HP = 20;
const ENEMY_CONTACT_DPS = 12;

export class MainScene extends Phaser.Scene {
  private formation = new SquadFormation(1, 'wedge');
  private squad: Character[] = [];
  private leaderPos: Vec2 = { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 };

  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<'up' | 'down' | 'left' | 'right', Phaser.Input.Keyboard.Key>;
  private numberKeys: Phaser.Input.Keyboard.Key[] = [];
  private shapeKey!: Phaser.Input.Keyboard.Key;

  private bullets!: Phaser.Physics.Arcade.Group;
  private enemies!: Phaser.Physics.Arcade.Group;

  private nextSpawnAt = 0;
  private spawnIntervalMs = 1400;
  private kills = 0;
  private hud!: Phaser.GameObjects.Text;
  private gameOver = false;

  constructor() {
    super('main');
  }

  create() {
    this.physics.world.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.cameras.main.setBackgroundColor('#14161c');

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasd = {
      up: this.input.keyboard!.addKey('W'),
      down: this.input.keyboard!.addKey('S'),
      left: this.input.keyboard!.addKey('A'),
      right: this.input.keyboard!.addKey('D'),
    };
    this.numberKeys = [
      this.input.keyboard!.addKey('ONE'),
      this.input.keyboard!.addKey('TWO'),
      this.input.keyboard!.addKey('THREE'),
      this.input.keyboard!.addKey('FOUR'),
      this.input.keyboard!.addKey('FIVE'),
    ];
    this.shapeKey = this.input.keyboard!.addKey('F');

    this.bullets = this.physics.add.group();
    this.enemies = this.physics.add.group();

    this.spawnCharacter();

    this.physics.add.overlap(this.bullets, this.enemies, (bulletObj, enemyObj) => {
      this.onBulletHitEnemy(bulletObj as Phaser.Physics.Arcade.Sprite, enemyObj as Phaser.Physics.Arcade.Sprite);
    });

    this.hud = this.add.text(10, 10, '', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#e5e7eb',
    });
    this.hud.setScrollFactor(0);
  }

  update(time: number, delta: number) {
    if (this.gameOver) return;

    const moveDir = this.readMoveInput();
    const dt = delta / 1000;
    this.leaderPos.x = Phaser.Math.Clamp(this.leaderPos.x + moveDir.x * SQUAD_MOVE_SPEED * dt, 20, WORLD_WIDTH - 20);
    this.leaderPos.y = Phaser.Math.Clamp(this.leaderPos.y + moveDir.y * SQUAD_MOVE_SPEED * dt, 20, WORLD_HEIGHT - 20);
    this.formation.updateFacing(moveDir);

    this.handleSquadSizeInput();
    if (Phaser.Input.Keyboard.JustDown(this.shapeKey)) this.formation.cycleShape();

    const slots = this.formation.getSlotWorldPositions(this.leaderPos);
    this.squad.forEach((character, i) => {
      character.moveToward(slots[i]);
      this.tryFire(character, time);
    });

    this.updateEnemies(dt, time);
    this.maybeSpawnEnemy(time);
    this.cleanupOffscreenBullets();
    this.updateHud();
  }

  // --- input & squad -------------------------------------------------

  private readMoveInput(): Vec2 {
    let x = 0;
    let y = 0;
    if (this.cursors.left.isDown || this.wasd.left.isDown) x -= 1;
    if (this.cursors.right.isDown || this.wasd.right.isDown) x += 1;
    if (this.cursors.up.isDown || this.wasd.up.isDown) y -= 1;
    if (this.cursors.down.isDown || this.wasd.down.isDown) y += 1;
    if (x === 0 && y === 0) return { x: 0, y: 0 };
    const len = Math.hypot(x, y);
    return { x: x / len, y: y / len };
  }

  private handleSquadSizeInput() {
    for (let i = 0; i < this.numberKeys.length; i++) {
      if (Phaser.Input.Keyboard.JustDown(this.numberKeys[i])) {
        this.setSquadSize(i + 1);
      }
    }
  }

  private setSquadSize(size: number) {
    const clamped = Phaser.Math.Clamp(size, 1, MAX_SQUAD_SIZE);
    this.formation.setCount(clamped);
    while (this.squad.length < clamped) this.spawnCharacter();
    while (this.squad.length > clamped) this.squad.pop()?.destroy();
  }

  private spawnCharacter() {
    this.squad.push(new Character(this, this.leaderPos.x, this.leaderPos.y, 'character'));
  }

  // --- combat ----------------------------------------------------------

  private tryFire(character: Character, time: number) {
    if (!character.canFire(time)) return;
    const target = this.findNearestEnemy(character.sprite.x, character.sprite.y, character.stats.range);
    if (!target) return;

    const dir = new Phaser.Math.Vector2(target.x - character.sprite.x, target.y - character.sprite.y).normalize();
    const bullet = this.bullets.get(character.sprite.x, character.sprite.y, 'bullet') as Phaser.Physics.Arcade.Sprite;
    if (!bullet) return;
    bullet.setActive(true).setVisible(true);
    const body = bullet.body as Phaser.Physics.Arcade.Body;
    body.enable = true;
    bullet.setData('damage', character.stats.damage);
    body.setVelocity(dir.x * character.stats.bulletSpeed, dir.y * character.stats.bulletSpeed);

    character.markFired(time);
  }

  private findNearestEnemy(x: number, y: number, maxRange: number): Phaser.Physics.Arcade.Sprite | null {
    let nearest: Phaser.Physics.Arcade.Sprite | null = null;
    let nearestDist = maxRange;
    for (const obj of this.enemies.getChildren()) {
      const enemy = obj as Phaser.Physics.Arcade.Sprite;
      if (!enemy.active) continue;
      const dist = Phaser.Math.Distance.Between(x, y, enemy.x, enemy.y);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = enemy;
      }
    }
    return nearest;
  }

  private onBulletHitEnemy(bullet: Phaser.Physics.Arcade.Sprite, enemy: Phaser.Physics.Arcade.Sprite) {
    bullet.setActive(false).setVisible(false);
    bullet.body!.enable = false;

    const hp = (enemy.getData('hp') as number) - (bullet.getData('damage') as number);
    enemy.setData('hp', hp);
    if (hp <= 0) {
      enemy.destroy();
      this.kills += 1;
    }
  }

  // --- enemies -----------------------------------------------------------

  private maybeSpawnEnemy(time: number) {
    if (time < this.nextSpawnAt) return;
    this.spawnIntervalMs = Math.max(350, 1400 - this.kills * 12);
    this.nextSpawnAt = time + this.spawnIntervalMs;

    const edge = Phaser.Math.Between(0, 3);
    const pos =
      edge === 0
        ? { x: Phaser.Math.Between(0, WORLD_WIDTH), y: -20 }
        : edge === 1
          ? { x: WORLD_WIDTH + 20, y: Phaser.Math.Between(0, WORLD_HEIGHT) }
          : edge === 2
            ? { x: Phaser.Math.Between(0, WORLD_WIDTH), y: WORLD_HEIGHT + 20 }
            : { x: -20, y: Phaser.Math.Between(0, WORLD_HEIGHT) };

    const enemy = this.enemies.create(pos.x, pos.y, 'enemy') as Phaser.Physics.Arcade.Sprite;
    enemy.setData('hp', ENEMY_BASE_HP + this.kills * 0.5);
  }

  private updateEnemies(dt: number, _time: number) {
    for (const obj of this.enemies.getChildren()) {
      const enemy = obj as Phaser.Physics.Arcade.Sprite;
      if (!enemy.active) continue;
      const dir = new Phaser.Math.Vector2(this.leaderPos.x - enemy.x, this.leaderPos.y - enemy.y).normalize();
      enemy.x += dir.x * ENEMY_BASE_SPEED * dt;
      enemy.y += dir.y * ENEMY_BASE_SPEED * dt;

      this.squad.forEach((character) => {
        const dist = Phaser.Math.Distance.Between(enemy.x, enemy.y, character.sprite.x, character.sprite.y);
        if (dist < 22) {
          character.hp -= ENEMY_CONTACT_DPS * dt;
        }
      });
    }

    this.squad = this.squad.filter((character) => {
      if (character.hp > 0) return true;
      character.destroy();
      return false;
    });
    if (this.squad.length === 0) this.endGame();
  }

  private cleanupOffscreenBullets() {
    for (const obj of this.bullets.getChildren()) {
      const bullet = obj as Phaser.Physics.Arcade.Sprite;
      if (bullet.active && (bullet.x < -10 || bullet.x > WORLD_WIDTH + 10 || bullet.y < -10 || bullet.y > WORLD_HEIGHT + 10)) {
        bullet.setActive(false).setVisible(false);
        (bullet.body as Phaser.Physics.Arcade.Body).enable = false;
      }
    }
  }

  private endGame() {
    this.gameOver = true;
    this.physics.pause();
    this.add
      .text(WORLD_WIDTH / 2, WORLD_HEIGHT / 2, `GAME OVER\nKills: ${this.kills}\nRefresh to retry`, {
        fontFamily: 'monospace',
        fontSize: '28px',
        color: '#f56565',
        align: 'center',
      })
      .setOrigin(0.5);
  }

  private updateHud() {
    this.hud.setText(
      [
        `Squad: ${this.squad.length}/${MAX_SQUAD_SIZE}  Formation: ${this.formation.shape}`,
        `Kills: ${this.kills}`,
        'Move: WASD/Arrows   Squad size: 1-5   Formation: F',
      ].join('\n'),
    );
  }
}
