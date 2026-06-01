import type { Config } from 'tailwindcss';
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: { 50: '#eff6ff', 500: '#3b82f6', 600: '#2563eb', 900: '#1e3a5f' },
        critical: '#dc2626',
        high: '#ea580c',
        medium: '#d97706',
        low: '#16a34a',
      },
    },
  },
  plugins: [],
};
export default config;
