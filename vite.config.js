import { defineConfig } from 'vite';
import path from 'path';
import { resolve } from 'path';
import react from '@vitejs/plugin-react';

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.js'), 
      name: 'JustLendV2Utils',
      fileName: 'justlend-v2-utils',
    },
    rollupOptions: {
      external: ['react', 'react-dom', 'tronweb'],
      output: {
        globals: {
          react: 'React',
          tronweb: 'TronWeb',
        },
      },
    },
  },
  plugins: [
    react(),
  ],
  resolve: {
    alias: {
      'justlend-v2-utils': path.resolve(__dirname, './dist/justlend-v2-utils.js'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
  },
});