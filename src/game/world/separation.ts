// Pure circle-vs-circle separation — no Phaser types, same as the formation module.

export interface Circle {
  x: number;
  y: number;
}

/**
 * Pushes overlapping equal-radius circles apart (each moves half the overlap along the line
 * between centers) until none are closer than `minDistance`, or `iterations` passes run out.
 * Uses a uniform grid so cost stays ~linear in the count rather than comparing every pair.
 * Mutates x/y in place, so it works directly on sprites as well as plain objects.
 */
export function separateCircles(circles: Circle[], minDistance: number, iterations = 3) {
  if (circles.length < 2) return;
  const cellSize = minDistance;

  for (let pass = 0; pass < iterations; pass++) {
    const grid = new Map<string, number[]>();
    circles.forEach((c, i) => {
      const key = cellKey(Math.floor(c.x / cellSize), Math.floor(c.y / cellSize));
      const cell = grid.get(key);
      if (cell) cell.push(i);
      else grid.set(key, [i]);
    });

    let moved = false;
    for (let i = 0; i < circles.length; i++) {
      const a = circles[i];
      const cx = Math.floor(a.x / cellSize);
      const cy = Math.floor(a.y / cellSize);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const cell = grid.get(cellKey(cx + dx, cy + dy));
          if (!cell) continue;
          for (const j of cell) {
            if (j <= i) continue; // each pair once
            const b = circles[j];
            let nx = b.x - a.x;
            let ny = b.y - a.y;
            let dist = Math.hypot(nx, ny);
            if (dist >= minDistance) continue;
            if (dist < 1e-6) {
              // Exactly stacked: derive a stable, distinct direction from the indices so they can part.
              const angle = i * 2.399963 + j;
              nx = Math.cos(angle);
              ny = Math.sin(angle);
              dist = 0;
            } else {
              nx /= dist;
              ny /= dist;
            }
            const half = (minDistance - dist) / 2;
            a.x -= nx * half;
            a.y -= ny * half;
            b.x += nx * half;
            b.y += ny * half;
            moved = true;
          }
        }
      }
    }
    if (!moved) return;
  }
}

function cellKey(cx: number, cy: number): string {
  return `${cx},${cy}`;
}
