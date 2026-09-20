import Phaser from 'phaser';
import { MAX_SQUAD_SIZE } from '../formation/Formation';
import type { AttackKind, Character } from '../entities/Character';

const ATTACK_LABELS: Record<AttackKind, string> = {
  shot: 'SHOT',
  arrow: 'ARROW',
  daggers: 'DAGGER',
  sword: 'SWORD',
  spear: 'SPEAR',
};

const CARD_MAX_WIDTH = 132;
const CARD_MIN_WIDTH = 64;
const CARD_HEIGHT = 62;
const CARD_GAP = 8;
const BOTTOM_MARGIN = 10;
const PADDING = 6;
const COMPACT_BELOW_WIDTH = 96; // narrower cards drop the attack name and keep just "#slot"
const HP_COLOR_HIGH = 0x4ade80;
const HP_COLOR_MID = 0xfacc15;
const HP_COLOR_LOW = 0xef4444;
const COOLDOWN_COLOR = 0xfacc15;
const EXP_COLOR = 0x22d3ee;

/**
 * Horizontal row of per-character cards along the bottom of the screen: attack name, level, and
 * three gauges — HP (green), attack cooldown (yellow, draining), and EXP toward the next level
 * (cyan, filled by the gems that character collected).
 *
 * `sideMargin` reserves room at both ends (for on-screen touch controls).
 */
export class SquadCards {
  private scene: Phaser.Scene;
  private graphics: Phaser.GameObjects.Graphics;
  private nameTexts: Phaser.GameObjects.Text[] = [];
  private levelTexts: Phaser.GameObjects.Text[] = [];
  private sideMargin: number;

  constructor(scene: Phaser.Scene, depth: number, sideMargin: number) {
    this.scene = scene;
    this.sideMargin = sideMargin;
    this.graphics = scene.add.graphics().setScrollFactor(0).setDepth(depth);
    for (let i = 0; i < MAX_SQUAD_SIZE; i++) {
      this.nameTexts.push(this.makeText(depth + 1, '#e5e7eb'));
      this.levelTexts.push(this.makeText(depth + 1, '#a5f3fc').setOrigin(1, 0));
    }
  }

  update(squad: Character[], timeMs: number) {
    const g = this.graphics;
    g.clear();

    const { width, height } = this.scene.scale;
    const available = width - this.sideMargin * 2;
    const cardWidth = Phaser.Math.Clamp((available - CARD_GAP * (MAX_SQUAD_SIZE - 1)) / MAX_SQUAD_SIZE, CARD_MIN_WIDTH, CARD_MAX_WIDTH);
    const totalWidth = squad.length * cardWidth + Math.max(0, squad.length - 1) * CARD_GAP;
    const left = (width - totalWidth) / 2;
    const top = height - BOTTOM_MARGIN - CARD_HEIGHT;
    const compact = cardWidth < COMPACT_BELOW_WIDTH;

    for (let i = 0; i < MAX_SQUAD_SIZE; i++) {
      const character = squad[i];
      this.nameTexts[i].setVisible(!!character);
      this.levelTexts[i].setVisible(!!character);
      if (!character) continue;

      const x = left + i * (cardWidth + CARD_GAP);
      const innerX = x + PADDING;
      const innerWidth = cardWidth - PADDING * 2;

      g.fillStyle(0x0f172a, 0.72);
      g.fillRoundedRect(x, top, cardWidth, CARD_HEIGHT, 6);
      g.fillStyle(character.tint, 0.9); // the character's color, tying the card to its sprite and cone
      g.fillRoundedRect(x, top, cardWidth, 4, { tl: 6, tr: 6, bl: 0, br: 0 });

      const name = compact ? `#${i + 1}` : `#${i + 1} ${ATTACK_LABELS[character.stats.attack]}`;
      this.nameTexts[i].setText(name).setPosition(innerX, top + 8);
      this.levelTexts[i].setText(`Lv${character.level}`).setPosition(x + cardWidth - PADDING, top + 8);

      const hpFrac = Phaser.Math.Clamp(character.hp / character.maxHp, 0, 1);
      const hpColor = hpFrac > 0.5 ? HP_COLOR_HIGH : hpFrac > 0.25 ? HP_COLOR_MID : HP_COLOR_LOW;
      this.bar(innerX, top + 26, innerWidth, 8, hpFrac, hpColor);
      this.bar(innerX, top + 38, innerWidth, 5, character.getCooldownFraction(timeMs), COOLDOWN_COLOR);
      this.bar(innerX, top + 47, innerWidth, 6, character.exp / character.expToNext, EXP_COLOR);
    }
  }

  private bar(x: number, y: number, width: number, height: number, fraction: number, color: number) {
    const g = this.graphics;
    g.fillStyle(0x2d3339, 1);
    g.fillRect(x, y, width, height);
    g.fillStyle(color, 1);
    g.fillRect(x, y, width * Phaser.Math.Clamp(fraction, 0, 1), height);
  }

  private makeText(depth: number, color: string): Phaser.GameObjects.Text {
    return this.scene.add
      .text(0, 0, '', { fontFamily: 'monospace', fontSize: '11px', color, fontStyle: 'bold' })
      .setScrollFactor(0)
      .setDepth(depth);
  }
}
