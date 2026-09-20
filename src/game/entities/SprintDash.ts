// Pure sprint speed curve — no Phaser types here on purpose, same reasoning as Stamina.ts.
// Starting a sprint surges to a burst speed that eases down to the cruising sprint speed, so the
// first moments read as a dash rather than a flat speed-up.

export interface SprintDashConfig {
  cruiseMultiplier: number; // steady-state sprint speed, as a multiple of walking speed
  burstMultiplier: number; // peak speed multiple on the very first frame of a sprint
  burstDurationSec: number; // how long the surge takes to settle down to cruise
}

const DEFAULT_CONFIG: SprintDashConfig = {
  cruiseMultiplier: 1.8,
  burstMultiplier: 3.2,
  burstDurationSec: 0.28,
};

export class SprintDash {
  private wasSprinting = false;
  private elapsed = 0;
  private config: SprintDashConfig;

  constructor(config: Partial<SprintDashConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** True only on the frame a sprint begins (the moment to fire takeoff effects). */
  justStarted = false;

  /** 1 the instant the dash begins, easing to 0 as the burst settles; 0 when not sprinting. */
  get burstFraction(): number {
    if (!this.wasSprinting) return 0;
    return Math.max(0, 1 - this.elapsed / this.config.burstDurationSec);
  }

  /** Advances one frame; returns the speed multiplier to apply to walking speed (1 when not sprinting). */
  update(isSprinting: boolean, dt: number): number {
    this.justStarted = isSprinting && !this.wasSprinting;
    if (this.justStarted) this.elapsed = 0;
    else if (isSprinting) this.elapsed += dt;
    this.wasSprinting = isSprinting;

    if (!isSprinting) return 1;
    const { cruiseMultiplier, burstMultiplier } = this.config;
    const t = this.burstFraction;
    // Ease-out cubic on the decay: most of the surge is felt up front, then it tapers into cruise.
    return cruiseMultiplier + (burstMultiplier - cruiseMultiplier) * t * t * t;
  }
}
