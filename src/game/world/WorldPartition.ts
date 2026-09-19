// Pure chunk-grid partitioning for an unbounded world — no Phaser types here on purpose,
// same as the formation module: this is the piece that should port to Unity largely unchanged.

export interface ChunkCoord {
  cx: number;
  cy: number;
}

export interface Vec2 {
  x: number;
  y: number;
}

export class WorldPartition {
  readonly chunkSize: number;
  readonly activeRadiusChunks: number;
  private activeChunks = new Set<string>();
  private centerChunk: ChunkCoord | null = null;

  constructor(chunkSize = 500, activeRadiusChunks = 3) {
    this.chunkSize = chunkSize;
    this.activeRadiusChunks = activeRadiusChunks;
  }

  worldToChunk(pos: Vec2): ChunkCoord {
    return {
      cx: Math.floor(pos.x / this.chunkSize),
      cy: Math.floor(pos.y / this.chunkSize),
    };
  }

  chunkCenter(chunk: ChunkCoord): Vec2 {
    return {
      x: (chunk.cx + 0.5) * this.chunkSize,
      y: (chunk.cy + 0.5) * this.chunkSize,
    };
  }

  isActive(pos: Vec2): boolean {
    return this.activeChunks.has(chunkKey(this.worldToChunk(pos)));
  }

  /**
   * Recomputes the active-chunk window around `centerPos`. Cheap no-op unless the
   * center has crossed into a new chunk. Returns chunks that just became active,
   * so callers can spawn content into newly discovered territory.
   */
  update(centerPos: Vec2): ChunkCoord[] {
    const nextCenter = this.worldToChunk(centerPos);
    if (this.centerChunk && nextCenter.cx === this.centerChunk.cx && nextCenter.cy === this.centerChunk.cy) {
      return [];
    }
    this.centerChunk = nextCenter;

    const nextActive = new Set<string>();
    const newlyActive: ChunkCoord[] = [];
    const r = this.activeRadiusChunks;
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        const chunk = { cx: nextCenter.cx + dx, cy: nextCenter.cy + dy };
        const key = chunkKey(chunk);
        nextActive.add(key);
        if (!this.activeChunks.has(key)) newlyActive.push(chunk);
      }
    }
    this.activeChunks = nextActive;
    return newlyActive;
  }
}

function chunkKey(chunk: ChunkCoord): string {
  return `${chunk.cx},${chunk.cy}`;
}
