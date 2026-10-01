import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 수집기로 넘긴다 → 같은 출처라 CORS 불필요 (02 문서 9장). TYCOON_COLLECTOR로 바꿀 수 있다 (e2e는 :4798)
const collector = process.env.TYCOON_COLLECTOR ?? 'http://127.0.0.1:4777';
export default defineConfig({ plugins: [react()], server: { proxy: { '/api': collector, '/hook': collector } } });
