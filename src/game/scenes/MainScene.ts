import Phaser from 'phaser';
import { SquadFormation } from '../formation/SquadFormation';
import { MAX_SQUAD_SIZE, angleDiff, getFormationLinks } from '../formation/Formation';
import type { Vec2 } from '../formation/Formation';
import { Character, DEFAULT_STATS, Y_SORT_DEPTH_OFFSET } from '../entities/Character';
import type { CharacterStats } from '../entities/Character';
import { ArrowSystem } from '../combat/ArrowSystem';
import { SwordSwingSystem } from '../combat/SwordSwingSystem';
import { DaggerSystem } from '../combat/DaggerSystem';
import { SquadCards } from '../ui/SquadCards';
import { MobileControls } from '../ui/MobileControls';
import { GemSystem } from '../pickups/GemSystem';
import { SpearSystem } from '../combat/SpearSystem';
import { Stamina } from '../entities/Stamina';
import { SprintDash } from '../entities/SprintDash';
import { SprintTrail } from '../ui/SprintTrail';
import { CHARACTER_COLORS } from './BootScene';
import { separateCircles } from '../world/separation';
import { WorldPartition } from '../world/WorldPartition';
import type { ChunkCoord } from '../world/WorldPartition';

const SQUAD_MOVE_SPEED = 220; // px/sec
const ENEMY_BASE_SPEED = 70;
const ENEMY_HP = DEFAULT_STATS.damage * 2; // always exactly 2 hits to kill, regardless of difficulty ramp
const ENEMY_CONTACT_DPS = 12;
const ENEMY_DIAMETER = 24; // matches the 12px-radius enemy texture; enemies are kept at least this far apart
const SPAWN_MARGIN = 60; // px outside the camera view where enemies pop in
const CHUNK_SIZE = 500;
const ACTIVE_RADIUS_CHUNKS = 4; // ~4000px active window kept simulated around the squad
const CHUNK_SPAWN_CHANCE = 0.4;

// Characters/enemies are Y-sorted (see Y_SORT_DEPTH_OFFSET); bullets and screen-space UI sit in
// depth bands clearly above that range so they're never accidentally hidden behind a body.
const DAMAGE_FLASH_DURATION_MS = 100;
const SWORD_REACH = 150; // well past the drawn cone tip
const SWORD_SWEEP_DEG = 160; // wider than the 90° attack cone that triggers it

// Per-slot attack loadouts, indexed by squad slot; a slot past the end of the list uses DEFAULT_STATS.
const SLOT_STATS: Partial<CharacterStats>[] = [
  { attack: 'arrow', fireRateMs: 650, range: 260 }, // piercing arrow that curves on to 1-3 more enemies
  { attack: 'daggers', fireRateMs: 800, damage: 4, range: 240, bulletSpeed: 640 }, // burst of light daggers at 1-3 nearby enemies
  { attack: 'sword', fireRateMs: 850, damage: 14, range: SWORD_REACH }, // wide melee swing out in front of the attack angle
  { attack: 'spear', fireRateMs: 1300, damage: 26, range: 320 }, // long, heavy thrust piercing everything on its line
];
const DAGGERS_PER_BURST = 3;
const DAGGER_STAGGER_MS = 70;
const DAGGER_TARGETS = 3;
const GEM_DEPTH = 5.5; // on the ground: above the attack cones (5), far below every Y-sorted character
const ENEMY_GEM_DROP_MIN = 1;
const ENEMY_GEM_DROP_MAX = 2;
const BULLET_DEPTH = Y_SORT_DEPTH_OFFSET * 2;
const UI_DEPTH = Y_SORT_DEPTH_OFFSET * 3;
const PAUSE_DEPTH = Y_SORT_DEPTH_OFFSET * 4;

export class MainScene extends Phaser.Scene {
  private formation = new SquadFormation(1, 'wedge');
  private squad: Character[] = [];
  private leaderPos: Vec2 = { x: 0, y: 0 };
  private partition = new WorldPartition(CHUNK_SIZE, ACTIVE_RADIUS_CHUNKS);
  private stamina = new Stamina();
  private sprintDash = new SprintDash();
  private sprintTrail!: SprintTrail;

  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<'up' | 'down' | 'left' | 'right', Phaser.Input.Keyboard.Key>;
  private numberKeys: Phaser.Input.Keyboard.Key[] = [];
  private shapeKey!: Phaser.Input.Keyboard.Key;
  private flipKey!: Phaser.Input.Keyboard.Key;
  private fullscreenKey!: Phaser.Input.Keyboard.Key;
  private sprintKey!: Phaser.Input.Keyboard.Key;
  private pauseKey!: Phaser.Input.Keyboard.Key;

  private bullets!: Phaser.Physics.Arcade.Group;
  private arrows!: ArrowSystem;
  private swords!: SwordSwingSystem;
  private spears!: SpearSystem;
  private daggers!: DaggerSystem;
  private mobile!: MobileControls;
  private gems!: GemSystem;
  private cards!: SquadCards;
  private gemsCollected = 0;
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
  private wasMoving = false;

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
    this.sprintTrail = new SprintTrail(this);
    this.pauseKey = this.input.keyboard!.addKey('ESC');

    this.bullets = this.physics.add.group();
    this.arrows = new ArrowSystem(
      this,
      BULLET_DEPTH,
      () => this.enemies.getChildren() as Phaser.Physics.Arcade.Sprite[],
      (enemy, damage) => this.damageEnemy(enemy, damage),
    );
    this.daggers = new DaggerSystem(this, BULLET_DEPTH, (enemy, damage) => this.damageEnemy(enemy, damage));
    this.spears = new SpearSystem(
      this,
      BULLET_DEPTH,
      () => this.enemies.getChildren() as Phaser.Physics.Arcade.Sprite[],
      (enemy, damage) => this.damageEnemy(enemy, damage),
    );
    this.swords = new SwordSwingSystem(
      this,
      BULLET_DEPTH,
      () => this.enemies.getChildren() as Phaser.Physics.Arcade.Sprite[],
      (enemy, damage) => this.damageEnemy(enemy, damage),
    );
    this.enemies = this.physics.add.group();
    this.formationLinks = this.add.graphics().setDepth(4);
    this.staminaBar = this.add.graphics().setScrollFactor(0).setDepth(UI_DEPTH);

    this.spawnCharacter();
    this.gems = new GemSystem(this, GEM_DEPTH);
    // Seed the initial active window: gems only — enemies must not start on top of the squad.
    this.scatterGems(this.partition.update(this.leaderPos));

    this.physics.add.overlap(this.bullets, this.enemies, (bulletObj, enemyObj) => {
      this.onBulletHitEnemy(bulletObj as Phaser.Physics.Arcade.Sprite, enemyObj as Phaser.Physics.Arcade.Sprite);
    });

    this.mobile = new MobileControls(this, PAUSE_DEPTH + 3); // above the pause overlay so the pause button can still resume

    // On touch the joystick and action buttons flank the bottom edge, so the cards keep clear of them.
    this.cards = new SquadCards(this, UI_DEPTH, this.mobile.enabled ? 230 : 20);

    this.hud = this.add.text(10, 10, '', {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#e5e7eb',
    });
    this.hud.setScrollFactor(0).setDepth(UI_DEPTH);

    this.pauseOverlay = this.add
      .rectangle(0, 0, this.scale.width, this.scale.height, 0x000000, 0.6)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(PAUSE_DEPTH)
      .setVisible(false);
    this.pauseText = this.add
      .text(this.scale.width / 2, this.scale.height / 2, this.mobile.enabled ? 'PAUSED\nTap II to resume' : 'PAUSED\nPress Esc to resume', {
        fontFamily: 'monospace',
        fontSize: '28px',
        color: '#e5e7eb',
        align: 'center',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(PAUSE_DEPTH + 1)
      .setVisible(false);
    this.scale.on(Phaser.Scale.Events.RESIZE, (size: Phaser.Structs.Size) => {
      this.pauseOverlay.setSize(size.width, size.height);
      this.pauseText.setPosition(size.width / 2, size.height / 2);
    });
  }

  update(time: number, delta: number) {
    if (this.gameOver) return;

    const mobileActions = this.mobile.consumeActions();
    if (Phaser.Input.Keyboard.JustDown(this.pauseKey) || mobileActions.includes('pause')) this.togglePause();
    this.mobile.update();
    if (this.isPaused) return;

    if (Phaser.Input.Keyboard.JustDown(this.fullscreenKey)) this.scale.toggleFullscreen();

    // Squad size / shape changes must land before formation.update() runs, so its per-slot
    // arrays are already sized/shaped correctly when read later this same frame.
    this.handleSquadSizeInput();
    for (const action of mobileActions) {
      if (action === 'squadUp') this.setSquadSize(this.squad.length + 1);
      else if (action === 'squadDown') this.setSquadSize(this.squad.length - 1);
    }
    if (Phaser.Input.Keyboard.JustDown(this.shapeKey) || mobileActions.includes('shape')) this.formation.cycleShape();
    if (Phaser.Input.Keyboard.JustDown(this.flipKey) || mobileActions.includes('flip')) this.formation.toggleFlip();

    const moveDir = this.readMoveInput();
    const dt = delta / 1000;
    const isMovingNow = moveDir.x !== 0 || moveDir.y !== 0;
    if (isMovingNow && !this.wasMoving) {
      // The squad just set off from a standstill — give followers a beat before they react.
      this.squad.forEach((character) => character.triggerStartMoveDelay());
    }
    this.wasMoving = isMovingNow;
    const wantsSprint = (this.sprintKey.isDown || this.mobile.sprintHeld) && isMovingNow;
    const isSprinting = this.stamina.update(wantsSprint, dt);
    const moveSpeed = SQUAD_MOVE_SPEED * this.sprintDash.update(isSprinting, dt);
    if (this.sprintDash.justStarted) this.sprintTrail.burst(this.squad, moveDir);
    this.leaderPos.x += moveDir.x * moveSpeed * dt;
    this.leaderPos.y += moveDir.y * moveSpeed * dt;
    this.formation.update(moveDir, this.leaderPos, dt);
    this.updateStaminaBar(isSprinting);

    this.cameras.main.centerOn(this.leaderPos.x, this.leaderPos.y);
    this.background.setTilePosition(this.cameras.main.scrollX, this.cameras.main.scrollY);

    const slots = this.formation.getSlotWorldPositions(this.leaderPos);
    const aimDirs = this.formation.getSlotAimWorldDirections();
    this.squad.forEach((character, i) => {
      character.moveToward(slots[i], dt);
      character.updateMovementFacing(moveDir, dt);
      character.setAimDirection(aimDirs[i]);
      character.updateVisuals(time);
      this.tryFire(character, time);
    });
    this.sprintTrail.update(time, isSprinting, this.squad);
    this.drawFormationLinks();
    this.arrows.update(dt);
    this.swords.update(dt);
    this.spears.update(dt);
    this.daggers.update(dt);

    this.updateEnemies(dt);
    this.maybeSpawnEnemy(time);
    const newChunks = this.partition.update(this.leaderPos);
    this.spawnIntoNewlyActiveChunks(newChunks);
    this.scatterGems(newChunks);
    this.gems.update(
      dt,
      this.squad.map((character) => character.getGroundPosition()),
      (index, value) => {
        this.squad[index].gainExp(value);
        this.gemsCollected += value;
      },
    );
    this.cullFarEntities();
    this.cards.update(this.squad, time);
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
    if (x === 0 && y === 0) return this.mobile.moveDir;
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
    if (clamped === this.squad.length) return;
    this.formation.setCount(clamped);
    while (this.squad.length < clamped) this.spawnCharacter();
    while (this.squad.length > clamped) this.squad.pop()?.destroy();
  }

  private spawnCharacter() {
    const isLeader = this.squad.length === 0;
    const tint = CHARACTER_COLORS[this.squad.length % CHARACTER_COLORS.length];
    this.squad.push(new Character(this, this.leaderPos.x, this.leaderPos.y, tint, SLOT_STATS[this.squad.length] ?? {}, isLeader));
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

    const targets = this.findEnemiesInCone(character);
    if (targets.length === 0) return;
    const target = targets[0];

    switch (character.stats.attack) {
      case 'arrow':
        this.arrows.fire(character.sprite, target, character.stats.damage, character.tint);
        break;
      case 'daggers':
        this.fireDaggerBurst(character, targets.slice(0, DAGGER_TARGETS));
        break;
      case 'sword': {
        const baseAngle = Math.atan2(character.aimDirection.y, character.aimDirection.x);
        this.swords.swing(
          () => (character.sprite.active ? character.getGroundPosition() : null),
          baseAngle,
          SWORD_SWEEP_DEG,
          character.stats.range,
          character.stats.damage,
          character.tint,
        );
        break;
      }
      case 'spear':
        this.spears.thrust(
          () => (character.sprite.active ? character.sprite : null),
          Math.atan2(target.y - character.sprite.y, target.x - character.sprite.x), // toward the nearest enemy in the arc, so it always connects
          character.stats.range,
          character.stats.damage,
          character.tint,
        );
        break;
      default:
        this.spawnBullet(character, target);
    }

    character.markFired(time);
  }

  /**
   * A quick volley of light daggers, staggered a beat apart. Each dagger goes to a *different*
   * enemy while there are enough of them — the burst prefers spreading over as many targets as it
   * can (up to DAGGER_TARGETS) and only doubles up on one when fewer are in range — and each
   * bows out to alternating sides so the volley fans out like knives thrown by hand.
   */
  private fireDaggerBurst(character: Character, targets: Phaser.Physics.Arcade.Sprite[]) {
    for (let i = 0; i < DAGGERS_PER_BURST; i++) {
      this.daggers.throwDagger(
        () => (character.sprite.active ? character.sprite : null),
        targets[i % targets.length],
        character.stats.damage,
        character.tint,
        (i * DAGGER_STAGGER_MS) / 1000,
        i % 2 === 0 ? 1 : -1,
        0.28 + 0.08 * Math.floor(i / 2),
      );
    }
  }

  private spawnBullet(character: Character, target: Phaser.Physics.Arcade.Sprite) {
    const dir = new Phaser.Math.Vector2(target.x - character.sprite.x, target.y - character.sprite.y).normalize();
    const bullet = this.bullets.get(character.sprite.x, character.sprite.y, 'bullet') as Phaser.Physics.Arcade.Sprite;
    if (!bullet) return;
    bullet.setActive(true).setVisible(true).setDepth(BULLET_DEPTH);
    const body = bullet.body as Phaser.Physics.Arcade.Body;
    body.enable = true;
    bullet.setData('damage', character.stats.damage);
    body.setVelocity(dir.x * character.stats.bulletSpeed, dir.y * character.stats.bulletSpeed);
  }

  /** Enemies inside the character's watch arc and range, nearest first. */
  private findEnemiesInCone(character: Character): Phaser.Physics.Arcade.Sprite[] {
    const baseAngle = Math.atan2(character.aimDirection.y, character.aimDirection.x);
    const halfCone = Phaser.Math.DegToRad(character.stats.attackConeDeg) / 2;
    const origin = character.stats.attack === 'sword' ? character.getGroundPosition() : character.sprite;

    const found: { enemy: Phaser.Physics.Arcade.Sprite; dist: number }[] = [];
    for (const obj of this.enemies.getChildren()) {
      const enemy = obj as Phaser.Physics.Arcade.Sprite;
      if (!enemy.active) continue;
      const dist = Phaser.Math.Distance.Between(origin.x, origin.y, enemy.x, enemy.y);
      if (dist >= character.stats.range) continue;
      const angleToEnemy = Math.atan2(enemy.y - origin.y, enemy.x - origin.x);
      if (Math.abs(angleDiff(angleToEnemy, baseAngle)) > halfCone) continue;
      found.push({ enemy, dist });
    }
    return found.sort((a, b) => a.dist - b.dist).map((f) => f.enemy);
  }

  private onBulletHitEnemy(bullet: Phaser.Physics.Arcade.Sprite, enemy: Phaser.Physics.Arcade.Sprite) {
    bullet.setActive(false).setVisible(false);
    bullet.body!.enable = false;
    this.damageEnemy(enemy, bullet.getData('damage') as number);
  }

  private damageEnemy(enemy: Phaser.Physics.Arcade.Sprite, damage: number) {
    const hp = (enemy.getData('hp') as number) - damage;
    enemy.setData('hp', hp);
    if (hp <= 0) {
      const { x, y } = enemy;
      const drops = Phaser.Math.Between(ENEMY_GEM_DROP_MIN, ENEMY_GEM_DROP_MAX);
      for (let i = 0; i < drops; i++) {
        this.gems.spawn(x + Phaser.Math.Between(-22, 22), y + Phaser.Math.Between(-22, 22), 1, { x, y });
      }
      enemy.destroy();
      this.kills += 1;
      return;
    }
    enemy.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
    enemy.setData('flashUntil', this.time.now + DAMAGE_FLASH_DURATION_MS);
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

  private scatterGems(chunks: ChunkCoord[]) {
    for (const chunk of chunks) {
      this.gems.scatterChunk(chunk.cx * CHUNK_SIZE, chunk.cy * CHUNK_SIZE, CHUNK_SIZE);
    }
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

      const flashUntil = enemy.getData('flashUntil') as number | undefined;
      if (flashUntil !== undefined && this.time.now >= flashUntil) {
        enemy.setData('flashUntil', undefined);
        enemy.clearTint().setTintMode(Phaser.TintModes.MULTIPLY);
      }

      this.squad.forEach((character) => {
        const dist = Phaser.Math.Distance.Between(enemy.x, enemy.y, character.sprite.x, character.sprite.y);
        if (dist < 24) {
          character.takeDamage(ENEMY_CONTACT_DPS * dt, this.time.now);
        }
      });
    }

    // Enemies all chase the same target, so they bunch up; push overlapping ones apart so they
    // read as solid bodies instead of stacking into one blob.
    const active = (this.enemies.getChildren() as Phaser.Physics.Arcade.Sprite[]).filter((enemy) => enemy.active);
    separateCircles(active, ENEMY_DIAMETER);
    for (const enemy of active) enemy.setDepth(Y_SORT_DEPTH_OFFSET + enemy.y); // same Y-sort space as characters

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
    this.gems.cull((pos) => this.partition.isActive(pos));
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
      .text(this.cameras.main.width / 2, this.cameras.main.height / 2, `GAME OVER\nKills: ${this.kills}   Gems: ${this.gemsCollected}\n${this.mobile.enabled ? 'Tap to retry' : 'Refresh to retry'}`, {
        fontFamily: 'monospace',
        fontSize: '28px',
        color: '#f56565',
        align: 'center',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(PAUSE_DEPTH + 2);
    if (this.mobile.enabled) this.input.once('pointerdown', () => window.location.reload());
  }

  private updateHud() {
    this.hud.setText(
      [
        `Squad: ${this.squad.length}/${MAX_SQUAD_SIZE}  Formation: ${this.formation.shape}${this.formation.isFlipped() ? ' (flipped)' : ''}`,
        `Kills: ${this.kills}   Gems: ${this.gemsCollected}`,
        ...(this.mobile.enabled ? [] : ['Move: WASD/Arrows   Sprint: Shift   Squad size: 1-5   Formation: F   Flip fire: X   Fullscreen: Enter   Pause: Esc']),
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
