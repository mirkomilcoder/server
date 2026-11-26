import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Cockpit serves the package from /cockpit/@localhost/mirkomil/, so every asset
// URL must be relative ('./'). Absolute '/assets/...' paths would 404.
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@': r('./src'),
      '@fonts': r('./node_modules/@fontsource-variable'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020',
    // The polyfill would be harmless, but modern browsers don't need it.
    modulePreload: { polyfill: false },
    // Never inline assets as data: URIs — keeps us inside Cockpit's strict CSP.
    assetsInlineLimit: 0,
    sourcemap: mode === 'development',
    minify: mode !== 'development',
  },
}));
