/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      keyframes: {
        aurora: {
          '0%': { transform: 'translate3d(-10%, -10%, 0) scale(1)' },
          '50%': { transform: 'translate3d(12%, 8%, 0) scale(1.1)' },
          '100%': { transform: 'translate3d(-8%, -12%, 0) scale(1)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-6px)' },
        },
      },
      animation: {
        aurora: 'aurora 18s ease-in-out infinite',
        float: 'float 9s ease-in-out infinite',
      },
      boxShadow: {
        card: '0 24px 65px rgba(15, 23, 42, 0.45)',
      },
    },
  },
  plugins: [],
};
