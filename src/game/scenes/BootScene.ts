import Phaser from 'phaser';
import { GEM_TEXTURE } from '../pickups/GemSystem';

/** One distinct tint per squad slot, so each teammate reads as a separate character despite sharing one sprite sheet. */
export const CHARACTER_COLORS = [0x4fd1c5, 0xf6ad55, 0xb794f4, 0x68d391, 0xf687b3];

export const CHARACTER_TEXTURE = 'archer';
export const CHARACTER_FRAME_WIDTH = 112;
export const CHARACTER_FRAME_HEIGHT = 444;
export const CHARACTER_DISPLAY_HEIGHT = 168; // shrinks the ~444px-tall source art down to gameplay scale

// Per-frame lowest opaque pixel row (source px, from the frame's top). The sheet isn't cropped to
// the feet — and the padding under them differs between rows — so ground-anchored overlays read
// this instead of assuming the frame's bottom edge is where the character stands.
const frameFootRows: number[] = [];

export function frameFootRow(frameIndex: number): number {
  return frameFootRows[frameIndex] ?? CHARACTER_FRAME_HEIGHT;
}

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
    this.measureFootRows();
    this.makeCircleTexture('enemy', 12, 0xf56565);
    this.makeCircleTexture('bullet', 4, 0xf6e05e);
    this.makeGemTexture(GEM_TEXTURE);
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

  private measureFootRows() {
    const source = this.textures.get(CHARACTER_TEXTURE).getSourceImage() as HTMLImageElement;
    const canvas = document.createElement('canvas');
    canvas.width = source.width;
    canvas.height = source.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(source, 0, 0);

    const columns = Math.floor(source.width / CHARACTER_FRAME_WIDTH);
    const rows = Math.floor(source.height / CHARACTER_FRAME_HEIGHT);
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < columns; col++) {
        const { data } = ctx.getImageData(col * CHARACTER_FRAME_WIDTH, row * CHARACTER_FRAME_HEIGHT, CHARACTER_FRAME_WIDTH, CHARACTER_FRAME_HEIGHT);
        let foot = CHARACTER_FRAME_HEIGHT;
        search: for (let y = CHARACTER_FRAME_HEIGHT - 1; y >= 0; y--) {
          for (let x = 0; x < CHARACTER_FRAME_WIDTH; x++) {
            if (data[(y * CHARACTER_FRAME_WIDTH + x) * 4 + 3] > 20) {
              foot = y + 1;
              break search;
            }
          }
        }
        frameFootRows[row * columns + col] = foot;
      }
    }
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

  /** A small faceted diamond, cyan with a lighter top facet. */
  private makeGemTexture(key: string) {
    const diamond = [new Phaser.Math.Vector2(8, 0), new Phaser.Math.Vector2(16, 8), new Phaser.Math.Vector2(8, 16), new Phaser.Math.Vector2(0, 8)];
    const topFacet = [new Phaser.Math.Vector2(8, 0), new Phaser.Math.Vector2(16, 8), new Phaser.Math.Vector2(8, 8), new Phaser.Math.Vector2(0, 8)];
    const g = this.add.graphics();
    g.fillStyle(0x22d3ee, 1);
    g.fillPoints(diamond, true);
    g.fillStyle(0xa5f3fc, 1);
    g.fillPoints(topFacet, true);
    g.lineStyle(1, 0x0e7490, 1);
    g.strokePoints(diamond, true);
    g.generateTexture(key, 16, 16);
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
