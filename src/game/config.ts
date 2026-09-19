import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { MainScene } from './scenes/MainScene';

export const gameConfig: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'app',
  width: 960,
  height: 600,
  backgroundColor: '#14161c',
  physics: {
    default: 'arcade',
    arcade: { debug: false },
  },
  scene: [BootScene, MainScene],
};
