import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './renderer/src'),
      'shared': path.resolve(__dirname, './shared')
    }
  },
  plugins: [
    react(),
    tailwindcss(),
    electron([
      {
        entry: 'main/index.ts',
        onstart(options) {
          options.startup();
        },
        vite: {
          build: {
            sourcemap: true,
            minify: false,
            outDir: 'dist-electron/main',
            rollupOptions: {
              external: ['better-sqlite3']
            }
          }
        }
      },
      {
        entry: 'main/preload.ts',
        onstart(options) {
          options.reload();
        },
        vite: {
          build: {
            sourcemap: true,
            minify: false,
            outDir: 'dist-electron/main'
          }
        }
      }
    ]),
    renderer()
  ]
});
