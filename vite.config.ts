import { defineConfig } from 'vite';

// Relative base so the built assets resolve correctly whether served from the
// repo root or a GitHub Pages project subpath (https://<user>.github.io/<repo>/).
export default defineConfig({
  base: './',
});
