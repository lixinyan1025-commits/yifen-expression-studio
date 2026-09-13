import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({ mode }) => ({
  base: mode === 'pages' ? '/yifen-expression-studio/' : '/',
  publicDir: mode === 'pages' ? 'pages-public' : false,
  plugins: [react()],
  server: {
    watch: { ignored: ['**/.local/**', '**/test-results/**', '**/playwright-report/**'] },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react';
            return 'libraries';
          }
        },
      },
    },
  },
}));
