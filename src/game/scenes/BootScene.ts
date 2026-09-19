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
    this.makeGridTileTexture('ground-tile', 100, 0x14161c, 0x22252e);
    this.scene.start('main');
  }

  /** A single repeatable ground tile, used as an infinitely scrolling TileSprite background. */
  private makeGridTileTexture(key: string, size: number, bg: number, line: number) {
    const g = this.add.graphics();
    g.fillStyle(bg, 1);
    g.fillRect(0, 0, size, size);
    g.lineStyle(1, line, 1);
    g.strokeRect(0, 0, size, size);
    g.generateTexture(key, size, size);
    g.destroy();
  }

  private makeCircleTexture(key: string, radius: number, color: number) {
    const g = this.add.graphics();
    g.fillStyle(color, 1);
    g.fillCircle(radius, radius, radius);
    g.generateTexture(key, radius * 2, radius * 2);
    g.destroy();
  }
}
