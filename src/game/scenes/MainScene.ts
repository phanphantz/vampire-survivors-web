import Phaser from 'phaser';
import { SquadFormation } from '../formation/SquadFormation';
import { MAX_SQUAD_SIZE, angleDiff, getFormationLinks } from '../formation/Formation';
import type { Vec2 } from '../formation/Formation';
import { Character, DEFAULT_STATS } from '../entities/Character';
import { Stamina } from '../entities/Stamina';
import { CHARACTER_COLORS } from './BootScene';
import { WorldPartition } from '../world/WorldPartition';
import type { ChunkCoord } from '../world/WorldPartition';

const SQUAD_MOVE_SPEED = 220; // px/sec
const SPRINT_SPEED_MULTIPLIER = 1.8;
const ENEMY_BASE_SPEED = 70;
const ENEMY_HP = DEFAULT_STATS.damage * 2; // always exactly 2 hits to kill, regardless of difficulty ramp
const ENEMY_CONTACT_DPS = 12;
const SPAWN_MARGIN = 60; // px outside the camera view where enemies pop in
const CHUNK_SIZE = 500;
const ACTIVE_RADIUS_CHUNKS = 4; // ~4000px active window kept simulated around the squad
const CHUNK_SPAWN_CHANCE = 0.4;

export class MainScene extends Phaser.Scene {
  private formation = new SquadFormation(1, 'wedge');
  private squad: Character[] = [];
  private leaderPos: Vec2 = { x: 0, y: 0 };
  private partition = new WorldPartition(CHUNK_SIZE, ACTIVE_RADIUS_CHUNKS);
  private stamina = new Stamina();

  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<'up' | 'down' | 'left' | 'right', Phaser.Input.Keyboard.Key>;
  private numberKeys: Phaser.Input.Keyboard.Key[] = [];
  private shapeKey!: Phaser.Input.Keyboard.Key;
  private flipKey!: Phaser.Input.Keyboard.Key;
  private fullscreenKey!: Phaser.Input.Keyboard.Key;
  private sprintKey!: Phaser.Input.Keyboard.Key;
  private pauseKey!: Phaser.Input.Keyboard.Key;

  private bullets!: Phaser.Physics.Arcade.Group;
  private enemies!: Phaser.Physics.Arcade.Group;
  private background!: Phaser.GameObjects.TileSprite;
  private formationLinks!: Phaser.GameObjects.Graphics;
  private staminaBar!: Phaser.GameObjects.Graphics;
  private pauseOverlay!: Phaser.GameObjects.Rectangle;
  private pauseText!: Phaser.GameObjects.Text;

  private nextSpawnAt = 0;
  private spawnIntervalMs = 1400;
  private kills = 0;
  private hud!: Phaser.GameObjects.Text;
  private gameOver = false;
  private isPaused = false;

  constructor() {
    super('main');
  }

  create() {
    this.physics.world.setBounds(-1e6, -1e6, 2e6, 2e6);

    this.background = this.add
      .tileSprite(0, 0, this.scale.width, this.scale.height, 'ground-tile')
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(-100);

    this.scale.on(Phaser.Scale.Events.RESIZE, (size: Phaser.Structs.Size) => {
      this.background.setSize(size.width, size.height);
    });

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
    this.flipKey = this.input.keyboard!.addKey('X');
    this.fullscreenKey = this.input.keyboard!.addKey('ENTER');
    this.sprintKey = this.input.keyboard!.addKey('SHIFT');
    this.pauseKey = this.input.keyboard!.addKey('ESC');

    this.bullets = this.physics.add.group();
    this.enemies = this.physics.add.group();
    this.formationLinks = this.add.graphics().setDepth(4);
    this.staminaBar = this.add.graphics().setScrollFactor(0).setDepth(100);

    this.spawnCharacter();
    this.partition.update(this.leaderPos); // seed the initial active window without spawning

    this.physics.add.overlap(this.bullets, this.enemies, (bulletObj, enemyObj) => {
      this.onBulletHitEnemy(bulletObj as Phaser.Physics.Arcade.Sprite, enemyObj as Phaser.Physics.Arcade.Sprite);
    });

    this.hud = this.add.text(10, 10, '', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#e5e7eb',
    });
    this.hud.setScrollFactor(0).setDepth(100);

    this.pauseOverlay = this.add
      .rectangle(0, 0, this.scale.width, this.scale.height, 0x000000, 0.6)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(200)
      .setVisible(false);
    this.pauseText = this.add
      .text(this.scale.width / 2, this.scale.height / 2, 'PAUSED\nPress Esc to resume', {
        fontFamily: 'monospace',
        fontSize: '28px',
        color: '#e5e7eb',
        align: 'center',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(201)
      .setVisible(false);
    this.scale.on(Phaser.Scale.Events.RESIZE, (size: Phaser.Structs.Size) => {
      this.pauseOverlay.setSize(size.width, size.height);
      this.pauseText.setPosition(size.width / 2, size.height / 2);
    });
  }

  update(time: number, delta: number) {
    if (this.gameOver) return;

    if (Phaser.Input.Keyboard.JustDown(this.pauseKey)) this.togglePause();
    if (this.isPaused) return;

    if (Phaser.Input.Keyboard.JustDown(this.fullscreenKey)) this.scale.toggleFullscreen();

    // Squad size / shape changes must land before formation.update() runs, so its per-slot
    // arrays are already sized/shaped correctly when read later this same frame.
    this.handleSquadSizeInput();
    if (Phaser.Input.Keyboard.JustDown(this.shapeKey)) this.formation.cycleShape();
    if (Phaser.Input.Keyboard.JustDown(this.flipKey)) this.formation.toggleFlip();

    const moveDir = this.readMoveInput();
    const dt = delta / 1000;
    const wantsSprint = this.sprintKey.isDown && (moveDir.x !== 0 || moveDir.y !== 0);
    const isSprinting = this.stamina.update(wantsSprint, dt);
    const moveSpeed = SQUAD_MOVE_SPEED * (isSprinting ? SPRINT_SPEED_MULTIPLIER : 1);
    this.leaderPos.x += moveDir.x * moveSpeed * dt;
    this.leaderPos.y += moveDir.y * moveSpeed * dt;
    this.formation.update(moveDir, this.leaderPos, dt);
    this.updateStaminaBar(isSprinting);

    this.cameras.main.centerOn(this.leaderPos.x, this.leaderPos.y);
    this.background.setTilePosition(this.cameras.main.scrollX, this.cameras.main.scrollY);

    const slots = this.formation.getSlotWorldPositions(this.leaderPos);
    const aimDirs = this.formation.getSlotAimWorldDirections();
    this.squad.forEach((character, i) => {
      character.moveToward(slots[i]);
      character.updateMovementFacing(moveDir, dt);
      character.setAimDirection(aimDirs[i]);
      character.updateVisuals();
      this.tryFire(character, time);
    });
    this.drawFormationLinks();

    this.updateEnemies(dt);
    this.maybeSpawnEnemy(time);
    this.spawnIntoNewlyActiveChunks(this.partition.update(this.leaderPos));
    this.cullFarEntities();
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
    const isLeader = this.squad.length === 0;
    const tint = CHARACTER_COLORS[this.squad.length % CHARACTER_COLORS.length];
    this.squad.push(new Character(this, this.leaderPos.x, this.leaderPos.y, tint, {}, isLeader));
  }

  /** Draws the formation's topology: a smooth ring for circle, link lines between members otherwise. */
  private drawFormationLinks() {
    this.formationLinks.clear();
    this.formationLinks.lineStyle(2, 0x94a3b8, 0.45);

    if (this.formation.shape === 'circle' && !this.formation.isFlipped()) {
      if (this.squad.length > 0) {
        // Centered on the members' actual (eased) positions rather than leaderPos, which can
        // race ahead of them while moving and leave the ring visibly off-center.
        const center = this.squad.reduce(
          (sum, c) => ({ x: sum.x + c.sprite.x / this.squad.length, y: sum.y + c.sprite.y / this.squad.length }),
          { x: 0, y: 0 },
        );
        this.formationLinks.strokeCircle(center.x, center.y, this.formation.spacing);
      }
      return;
    }

    for (const link of getFormationLinks(this.formation.shape, this.squad.length, this.formation.isFlipped())) {
      const a = this.squad[link.from];
      const b = this.squad[link.to];
      if (!a || !b) continue;
      this.formationLinks.lineBetween(a.sprite.x, a.sprite.y, b.sprite.x, b.sprite.y);
    }
  }

  // --- combat ----------------------------------------------------------

  // Each slot's formation-assigned heading (see Formation.getAttackDirections) defines a wide
  // watch arc, not a razor-precise line — within that arc and its range, it auto-targets and
  // fires straight at the nearest enemy. The formation shape decides *where* each slot looks;
  // targeting decides *what* it shoots once something is there.
  private tryFire(character: Character, time: number) {
    if (!character.canFire(time)) return;

    const target = this.findNearestEnemyInCone(character);
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

  private findNearestEnemyInCone(character: Character): Phaser.Physics.Arcade.Sprite | null {
    const baseAngle = Math.atan2(character.aimDirection.y, character.aimDirection.x);
    const halfCone = Phaser.Math.DegToRad(character.stats.attackConeDeg) / 2;
    const { x, y } = character.sprite;

    let nearest: Phaser.Physics.Arcade.Sprite | null = null;
    let nearestDist = character.stats.range;
    for (const obj of this.enemies.getChildren()) {
      const enemy = obj as Phaser.Physics.Arcade.Sprite;
      if (!enemy.active) continue;
      const dist = Phaser.Math.Distance.Between(x, y, enemy.x, enemy.y);
      if (dist >= nearestDist) continue;
      const angleToEnemy = Math.atan2(enemy.y - y, enemy.x - x);
      if (Math.abs(angleDiff(angleToEnemy, baseAngle)) > halfCone) continue;
      nearestDist = dist;
      nearest = enemy;
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

  /** Continuous pressure: pops enemies in just outside whatever the camera currently sees. */
  private maybeSpawnEnemy(time: number) {
    if (time < this.nextSpawnAt) return;
    this.spawnIntervalMs = Math.max(350, 1400 - this.kills * 12);
    this.nextSpawnAt = time + this.spawnIntervalMs;

    const view = this.cameras.main.worldView;
    const edge = Phaser.Math.Between(0, 3);
    const pos =
      edge === 0
        ? { x: Phaser.Math.Between(view.left, view.right), y: view.top - SPAWN_MARGIN }
        : edge === 1
          ? { x: view.right + SPAWN_MARGIN, y: Phaser.Math.Between(view.top, view.bottom) }
          : edge === 2
            ? { x: Phaser.Math.Between(view.left, view.right), y: view.bottom + SPAWN_MARGIN }
            : { x: view.left - SPAWN_MARGIN, y: Phaser.Math.Between(view.top, view.bottom) };

    this.spawnEnemyAt(pos.x, pos.y);
  }

  /** Exploration bonus: newly discovered chunks (from the world partition) get a chance to seed an enemy. */
  private spawnIntoNewlyActiveChunks(newChunks: ChunkCoord[]) {
    for (const chunk of newChunks) {
      if (Math.random() > CHUNK_SPAWN_CHANCE) continue;
      const center = this.partition.chunkCenter(chunk);
      const jitter = CHUNK_SIZE * 0.35;
      this.spawnEnemyAt(center.x + Phaser.Math.Between(-jitter, jitter), center.y + Phaser.Math.Between(-jitter, jitter));
    }
  }

  private spawnEnemyAt(x: number, y: number) {
    const enemy = this.enemies.create(x, y, 'enemy') as Phaser.Physics.Arcade.Sprite;
    enemy.setData('hp', ENEMY_HP);
  }

  private updateEnemies(dt: number) {
    for (const obj of this.enemies.getChildren()) {
      const enemy = obj as Phaser.Physics.Arcade.Sprite;
      if (!enemy.active) continue;
      const dir = new Phaser.Math.Vector2(this.leaderPos.x - enemy.x, this.leaderPos.y - enemy.y).normalize();
      enemy.x += dir.x * ENEMY_BASE_SPEED * dt;
      enemy.y += dir.y * ENEMY_BASE_SPEED * dt;

      this.squad.forEach((character) => {
        const dist = Phaser.Math.Distance.Between(enemy.x, enemy.y, character.sprite.x, character.sprite.y);
        if (dist < 24) {
          character.hp -= ENEMY_CONTACT_DPS * dt;
        }
      });
    }

    const survivorCount = this.squad.length;
    this.squad = this.squad.filter((character) => {
      if (character.hp > 0) return true;
      character.destroy();
      return false;
    });
    // A death shrinks the squad without going through setSquadSize(), so the formation's own
    // count (and the per-slot arrays it drives) must be synced here too — otherwise it keeps
    // computing positions/topology for the old, larger squad and survivors land in wrong slots.
    if (this.squad.length !== survivorCount) this.formation.setCount(this.squad.length);
    if (this.squad.length === 0) this.endGame();
  }

  /** Bounds the simulation: anything that has drifted outside the partition's active window is dropped. */
  private cullFarEntities() {
    for (const obj of this.enemies.getChildren()) {
      const enemy = obj as Phaser.Physics.Arcade.Sprite;
      if (enemy.active && !this.partition.isActive({ x: enemy.x, y: enemy.y })) {
        enemy.destroy();
      }
    }
    for (const obj of this.bullets.getChildren()) {
      const bullet = obj as Phaser.Physics.Arcade.Sprite;
      if (bullet.active && !this.partition.isActive({ x: bullet.x, y: bullet.y })) {
        bullet.setActive(false).setVisible(false);
        (bullet.body as Phaser.Physics.Arcade.Body).enable = false;
      }
    }
  }

  private togglePause() {
    this.isPaused = !this.isPaused;
    if (this.isPaused) {
      this.physics.pause();
    } else {
      this.physics.resume();
    }
    this.pauseOverlay.setVisible(this.isPaused);
    this.pauseText.setVisible(this.isPaused);
  }

  private endGame() {
    this.gameOver = true;
    this.physics.pause();
    this.add
      .text(this.cameras.main.width / 2, this.cameras.main.height / 2, `GAME OVER\nKills: ${this.kills}\nRefresh to retry`, {
        fontFamily: 'monospace',
        fontSize: '28px',
        color: '#f56565',
        align: 'center',
      })
      .setOrigin(0.5)
      .setScrollFactor(0);
  }

  private updateHud() {
    this.hud.setText(
      [
        `Squad: ${this.squad.length}/${MAX_SQUAD_SIZE}  Formation: ${this.formation.shape}${this.formation.isFlipped() ? ' (flipped)' : ''}`,
        `Kills: ${this.kills}`,
        'Move: WASD/Arrows   Sprint: Shift   Squad size: 1-5   Formation: F   Flip fire: X   Fullscreen: Enter   Pause: Esc',
      ].join('\n'),
    );
  }

  private updateStaminaBar(isSprinting: boolean) {
    const x = 10;
    const y = 76;
    const width = 160;
    const height = 10;

    this.staminaBar.clear();
    this.staminaBar.fillStyle(0x000000, 0.5);
    this.staminaBar.fillRect(x - 2, y - 2, width + 4, height + 4);
    this.staminaBar.fillStyle(0x2d3339, 1);
    this.staminaBar.fillRect(x, y, width, height);

    const color = this.stamina.isExhausted ? 0x64748b : isSprinting ? 0xfbbf24 : 0x38bdf8;
    this.staminaBar.fillStyle(color, 1);
    this.staminaBar.fillRect(x, y, width * this.stamina.fraction, height);
  }
}
