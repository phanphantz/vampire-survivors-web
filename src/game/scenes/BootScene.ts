import Phaser from 'phaser';

/** One distinct tint per squad slot, so each teammate reads as a separate character despite sharing one sprite sheet. */
export const CHARACTER_COLORS = [0x4fd1c5, 0xf6ad55, 0xb794f4, 0x68d391, 0xf687b3];

export const CHARACTER_TEXTURE = 'archer';
export const CHARACTER_FRAME_WIDTH = 112;
export const CHARACTER_FRAME_HEIGHT = 444;
export const CHARACTER_DISPLAY_HEIGHT = 52; // shrinks the ~444px-tall source art down to gameplay scale

const FRAMES_PER_DIRECTION = 4;
const DIRECTION_COUNT = 8;

export function idleAnimKey(directionIndex: number): string {
  return `idle-${directionIndex}`;
}

/**
 * Generates flat-color textures at boot (no art assets needed for those), and loads the
 * 8-directional idle sprite sheet used for every squad member.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  preload() {
    this.load.spritesheet(CHARACTER_TEXTURE, 'sprites/character-8dir.png', {
      frameWidth: CHARACTER_FRAME_WIDTH,
      frameHeight: CHARACTER_FRAME_HEIGHT,
    });
  }

  create() {
    this.makeCircleTexture('enemy', 12, 0xf56565);
    this.makeCircleTexture('bullet', 4, 0xf6e05e);
    this.makeGridTileTexture('ground-tile', 100, 0x14161c, 0x22252e);

    for (let g = 0; g < DIRECTION_COUNT; g++) {
      this.anims.create({
        key: idleAnimKey(g),
        frames: this.anims.generateFrameNumbers(CHARACTER_TEXTURE, {
          start: g * FRAMES_PER_DIRECTION,
          end: g * FRAMES_PER_DIRECTION + FRAMES_PER_DIRECTION - 1,
        }),
        frameRate: 6,
        repeat: -1,
      });
    }

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
