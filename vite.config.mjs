import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Build each entry point as a self-contained IIFE bundle.
// WordPress loads scripts as classic <script> tags (not ES modules),
// so code-splitting with import() would fail silently.
const entry = process.env.VITE_ENTRY || 'all';

const configs = {
  admin: {
    plugins: [react()],
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      rollupOptions: {
        external: ['react', 'react-dom', '@wordpress/i18n'],
        input: { 'admin-template-builder': 'admin/js/template-builder/src/index.jsx' },
        output: {
          format: 'iife',
          entryFileNames: '[name].js',
          assetFileNames: '[name][extname]',
          globals: {
            'react': 'React',
            'react-dom': 'ReactDOM',
            '@wordpress/i18n': 'wp.i18n',
          },
        },
      },
    },
  },
  frontend: {
    plugins: [react()],
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      rollupOptions: {
        external: ['@wordpress/i18n'],
        input: { 'frontend-designer': 'frontend/js/designer/src/index.jsx' },
        output: {
          format: 'iife',
          entryFileNames: '[name].js',
          assetFileNames: '[name][extname]',
          globals: {
            '@wordpress/i18n': 'wp.i18n',
          },
        },
      },
    },
  },
};

export default defineConfig(configs[entry] || configs.admin);
