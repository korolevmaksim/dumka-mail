import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import path from 'path';

export default defineConfig(() => {
  const isMarketingDemo = process.env.VITE_MARKETING_DEMO === '1';
  const electronPlugins = isMarketingDemo
    ? []
    : [electron([
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
              external: ['better-sqlite3', '@modelcontextprotocol/sdk', 'eventsource']
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
      },
      {
        entry: 'main/databaseWorker.ts',
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
        entry: 'main/semanticSearchWorker.ts',
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
      }
    ]), renderer()];

  return {
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './renderer/src'),
        'shared': path.resolve(__dirname, './shared')
      }
    },
    plugins: [
      react(),
      tailwindcss(),
      ...electronPlugins,
    ]
  };
});
