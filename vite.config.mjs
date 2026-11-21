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
      emptyOutDir: false,
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
  'design-templates': {
    plugins: [react()],
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      rollupOptions: {
        external: ['react', 'react-dom', '@wordpress/i18n'],
        input: { 'admin-design-templates': 'admin/js/design-templates/src/index.jsx' },
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
  clipart: {
    plugins: [react()],
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      rollupOptions: {
        external: ['react', 'react-dom', '@wordpress/i18n'],
        input: { 'admin-clipart': 'admin/js/clipart/src/index.jsx' },
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
  fonts: {
    plugins: [react()],
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      rollupOptions: {
        external: ['react', 'react-dom', '@wordpress/i18n'],
        input: { 'admin-fonts': 'admin/js/fonts/src/index.jsx' },
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
  // Pro production exports (pro/js/designer-export). Not in the free build or
  // the public source — see that folder's index.js. 'fabric' is external and
  // resolves to the designer's own Fabric (window.sgpdFabric), so exports are
  // rendered by the same classes and patches as the customer's canvas.
  'frontend-pro': {
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      rollupOptions: {
        external: ['fabric'],
        input: { 'frontend-designer-pro': 'pro/js/designer-export/src/index.js' },
        output: {
          format: 'iife',
          entryFileNames: '[name].js',
          globals: { fabric: 'sgpdFabric' },
        },
      },
    },
  },
};

export default defineConfig(configs[entry] || configs.admin);
