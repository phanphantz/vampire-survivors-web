import Phaser from 'phaser';
import type { Vec2 } from '../formation/Formation';

export type MobileAction = 'shape' | 'flip' | 'pause' | 'squadUp' | 'squadDown';

const JOYSTICK_RADIUS = 64;
const JOYSTICK_THUMB_RADIUS = 28;
const JOYSTICK_DEADZONE = 0.25; // fraction of the radius; below this the stick reads as centered
const JOYSTICK_ZONE_FRACTION = 0.55; // a touch starting in the left this-much of the screen grabs the stick
const IDLE_ALPHA = 0.18;
const ACTIVE_ALPHA = 0.4;
const BUTTON_COLOR = 0x94a3b8;

interface Button {
  circle: Phaser.GameObjects.Arc;
  label: Phaser.GameObjects.Text;
}

/**
 * On-screen touch controls: a floating virtual joystick (touch down anywhere on the left side and
 * drag) plus tap/hold buttons on the right. Enabled only on touch devices. One-shot buttons are
 * queued and drained by the scene each frame (consumeActions) so they land at the same point in
 * the update loop as their keyboard equivalents; movement and sprint are polled state.
 */
export class MobileControls {
  readonly enabled: boolean;

  private scene: Phaser.Scene;
  private depth: number;
  private stick: Phaser.GameObjects.Graphics;
  private buttons = new Map<string, Button>();
  private pendingActions: MobileAction[] = [];

  private stickPointerId: number | null = null;
  private stickBase: Vec2 = { x: 0, y: 0 };
  private stickVector: Vec2 = { x: 0, y: 0 }; // raw offset from base, clamped to JOYSTICK_RADIUS
  private sprintPointerId: number | null = null;

  constructor(scene: Phaser.Scene, depth: number) {
    this.scene = scene;
    this.depth = depth;
    this.enabled = scene.sys.game.device.input.touch;
    this.stick = scene.add.graphics().setScrollFactor(0).setDepth(depth);
    if (!this.enabled) {
      this.stick.setVisible(false);
      return;
    }

    scene.input.addPointer(3); // joystick + sprint + one more button at once

    this.addButton('sprint', 'RUN', 46, 20);
    this.addButton('shape', 'FORM', 32, 12);
    this.addButton('flip', 'FLIP', 32, 12);
    this.addButton('squadDown', '-', 24, 22);
    this.addButton('squadUp', '+', 24, 22);
    this.addButton('pause', 'II', 24, 16);

    this.button('sprint').circle.on('pointerdown', (p: Phaser.Input.Pointer) => (this.sprintPointerId = p.id));
    this.button('shape').circle.on('pointerdown', () => this.pendingActions.push('shape'));
    this.button('flip').circle.on('pointerdown', () => this.pendingActions.push('flip'));
    this.button('squadDown').circle.on('pointerdown', () => this.pendingActions.push('squadDown'));
    this.button('squadUp').circle.on('pointerdown', () => this.pendingActions.push('squadUp'));
    this.button('pause').circle.on('pointerdown', () => this.pendingActions.push('pause'));

    scene.input.on('pointerdown', (p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) => this.onPointerDown(p, over));
    scene.input.on('pointermove', (p: Phaser.Input.Pointer) => this.onPointerMove(p));
    scene.input.on('pointerup', (p: Phaser.Input.Pointer) => this.onPointerUp(p));
    scene.input.on('pointerupoutside', (p: Phaser.Input.Pointer) => this.onPointerUp(p));

    scene.scale.on(Phaser.Scale.Events.RESIZE, () => this.layout());
    this.layout();
  }

  /** Unit movement direction from the stick, or (0,0) inside the deadzone / when untouched. */
  get moveDir(): Vec2 {
    const len = Math.hypot(this.stickVector.x, this.stickVector.y);
    if (len < JOYSTICK_DEADZONE * JOYSTICK_RADIUS) return { x: 0, y: 0 };
    return { x: this.stickVector.x / len, y: this.stickVector.y / len };
  }

  get sprintHeld(): boolean {
    return this.sprintPointerId !== null;
  }

  consumeActions(): MobileAction[] {
    const actions = this.pendingActions;
    this.pendingActions = [];
    return actions;
  }

  /** Redrawn every frame: the stick's look depends on live touch state. */
  update() {
    if (!this.enabled) return;
    const g = this.stick;
    g.clear();
    const active = this.stickPointerId !== null;
    const base = active ? this.stickBase : this.restingStickBase();
    const alpha = active ? ACTIVE_ALPHA : IDLE_ALPHA;
    g.lineStyle(3, 0xffffff, alpha);
    g.strokeCircle(base.x, base.y, JOYSTICK_RADIUS);
    g.fillStyle(0xffffff, alpha * 0.4);
    g.fillCircle(base.x, base.y, JOYSTICK_RADIUS);
    g.fillStyle(0xffffff, alpha * 1.6);
    g.fillCircle(base.x + this.stickVector.x, base.y + this.stickVector.y, JOYSTICK_THUMB_RADIUS);

    const sprint = this.button('sprint');
    sprint.circle.setFillStyle(BUTTON_COLOR, this.sprintHeld ? 0.6 : 0.25);
  }

  private restingStickBase(): Vec2 {
    const { width, height } = this.scene.scale;
    return { x: Math.min(120, width * 0.2), y: height - 120 };
  }

  private addButton(name: string, text: string, radius: number, fontSize: number) {
    const circle = this.scene.add
      .circle(0, 0, radius, BUTTON_COLOR, 0.25)
      .setStrokeStyle(2, 0xffffff, 0.45)
      .setScrollFactor(0)
      .setDepth(this.depth)
      .setInteractive();
    const label = this.scene.add
      .text(0, 0, text, { fontFamily: 'monospace', fontSize: `${fontSize}px`, color: '#e5e7eb', fontStyle: 'bold' })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(this.depth + 1)
      .setAlpha(0.8);
    this.buttons.set(name, { circle, label });
  }

  private button(name: string): Button {
    return this.buttons.get(name)!;
  }

  private place(name: string, x: number, y: number) {
    const b = this.button(name);
    b.circle.setPosition(x, y);
    b.label.setPosition(x, y);
  }

  private layout() {
    const { width, height } = this.scene.scale;
    this.place('sprint', width - 80, height - 90);
    this.place('shape', width - 190, height - 60);
    this.place('flip', width - 150, height - 155);
    this.place('pause', width - 40, 40);
    this.place('squadUp', width - 100, 40);
    this.place('squadDown', width - 155, 40);
  }

  private onPointerDown(p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]) {
    if (over.length > 0) return; // landed on a button
    if (this.stickPointerId !== null) return;
    if (p.x > this.scene.scale.width * JOYSTICK_ZONE_FRACTION) return;
    this.stickPointerId = p.id;
    this.stickBase = { x: p.x, y: p.y };
    this.stickVector = { x: 0, y: 0 };
  }

  private onPointerMove(p: Phaser.Input.Pointer) {
    if (p.id !== this.stickPointerId) return;
    const dx = p.x - this.stickBase.x;
    const dy = p.y - this.stickBase.y;
    const len = Math.hypot(dx, dy);
    const scale = len > JOYSTICK_RADIUS ? JOYSTICK_RADIUS / len : 1;
    this.stickVector = { x: dx * scale, y: dy * scale };
  }

  private onPointerUp(p: Phaser.Input.Pointer) {
    if (p.id === this.stickPointerId) {
      this.stickPointerId = null;
      this.stickVector = { x: 0, y: 0 };
    }
    if (p.id === this.sprintPointerId) this.sprintPointerId = null;
  }
}
