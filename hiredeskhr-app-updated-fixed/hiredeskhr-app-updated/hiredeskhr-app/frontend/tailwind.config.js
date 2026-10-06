/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    screens: {
      xs: '420px',
      sm: '640px',
      md: '768px',
      lg: '1024px',
      xl: '1280px',
      '2xl': '1536px',
    },
    extend: {
      colors: {
        brand: {
          50: '#f0fdfa',
          100: '#ccfbf1',
          200: '#99f6e4',
          300: '#5eead4',
          400: '#2dd4bf',
          500: '#14b8a6',
          600: '#0d9488',
          700: '#0f766e',
          800: '#115e59',
          900: '#134e4a',
          950: '#042f2e',
        },
        electric: {
          teal: '#06b6d4',
          emerald: '#10b981',
          mint: '#34d399',
          cyan: '#22d3ee',
          amber: '#f59e0b',
        },
        obsidian: {
          800: '#111827',
          900: '#090d16',
          950: '#05070d',
        }
      },
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        'glow-teal': '0 0 30px -5px rgba(20, 184, 166, 0.35)',
        'glow-emerald': '0 0 30px -5px rgba(16, 185, 129, 0.35)',
        'glass': '0 8px 32px 0 rgba(0, 0, 0, 0.08)',
      }
    },
  },
  plugins: [],
};
