import Phaser from 'phaser';

/** One distinct color per squad slot, so each teammate reads as a separate character. */
export const CHARACTER_COLORS = [0x4fd1c5, 0xf6ad55, 0xb794f4, 0x68d391, 0xf687b3];

export function characterTextureKey(slotIndex: number): string {
  return `character-${slotIndex % CHARACTER_COLORS.length}`;
}

/** Generates flat-color textures at boot so the prototype needs no art assets. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  create() {
    CHARACTER_COLORS.forEach((color, i) => this.makeRectTexture(characterTextureKey(i), 16, 28, color));
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

  /**
   * Squad members render as a vertical rounded rectangle with a small "head" dot on the
   * +x edge — since sprite rotation 0 means facing +x, that dot is what makes turning
   * (toward movement / formation heading) visually read as the character facing somewhere.
   */
  private makeRectTexture(key: string, width: number, height: number, color: number) {
    const g = this.add.graphics();
    g.fillStyle(color, 1);
    g.fillRoundedRect(0, 0, width, height, 4);
    g.lineStyle(2, 0xffffff, 0.35);
    g.strokeRoundedRect(1, 1, width - 2, height - 2, 3);
    g.fillStyle(0xffffff, 0.9);
    g.fillCircle(width - 3, height / 2, 2.5);
    g.generateTexture(key, width, height);
    g.destroy();
  }
}
