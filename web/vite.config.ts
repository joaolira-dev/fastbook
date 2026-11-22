import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // acessível pelo celular na mesma rede
    port: 5173,
    proxy: { '/api': 'http://localhost:3000' },
  },
});
