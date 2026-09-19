import Phaser from 'phaser';

/** Generates flat-color circle textures at boot so the prototype needs no art assets. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  create() {
    this.makeCircleTexture('character', 14, 0x4fd1c5);
    this.makeCircleTexture('enemy', 12, 0xf56565);
    this.makeCircleTexture('bullet', 4, 0xf6e05e);
    this.scene.start('main');
  }

  private makeCircleTexture(key: string, radius: number, color: number) {
    const g = this.add.graphics();
    g.fillStyle(color, 1);
    g.fillCircle(radius, radius, radius);
    g.generateTexture(key, radius * 2, radius * 2);
    g.destroy();
  }
}
