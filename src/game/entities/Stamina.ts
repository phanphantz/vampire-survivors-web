// Pure stamina/sprint meter — no Phaser types here on purpose, same reasoning as Formation.ts.

export interface StaminaConfig {
  max: number;
  drainPerSec: number;
  regenPerSec: number;
  minFractionToResume: number; // must refill to at least this fraction before sprinting again once exhausted
}

const DEFAULT_CONFIG: StaminaConfig = {
  max: 100,
  drainPerSec: 32,
  regenPerSec: 18,
  minFractionToResume: 0.25,
};

export class Stamina {
  readonly max: number;
  current: number;
  private drainPerSec: number;
  private regenPerSec: number;
  private minFractionToResume: number;
  private exhausted = false;

  constructor(config: Partial<StaminaConfig> = {}) {
    const { max, drainPerSec, regenPerSec, minFractionToResume } = { ...DEFAULT_CONFIG, ...config };
    this.max = max;
    this.current = max;
    this.drainPerSec = drainPerSec;
    this.regenPerSec = regenPerSec;
    this.minFractionToResume = minFractionToResume;
  }

  get fraction(): number {
    return this.current / this.max;
  }

  get isExhausted(): boolean {
    return this.exhausted;
  }

  /** Advances the meter one frame given whether sprint is being requested; returns whether sprint is actually active. */
  update(wantsSprint: boolean, dt: number): boolean {
    if (this.exhausted && this.fraction >= this.minFractionToResume) this.exhausted = false;

    const isSprinting = wantsSprint && !this.exhausted && this.current > 0;
    if (isSprinting) {
      this.current = Math.max(0, this.current - this.drainPerSec * dt);
      if (this.current === 0) this.exhausted = true;
    } else {
      this.current = Math.min(this.max, this.current + this.regenPerSec * dt);
    }
    return isSprinting;
  }
}
