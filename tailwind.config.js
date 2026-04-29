/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/**/*.{html,tsx,ts,jsx,js}'],
  theme: {
    extend: {
      colors: {
        surface: {
          base: '#0f0f0f',
          panel: '#1a1a1a',
          hover: '#222222',
          border: '#2a2a2a',
        },
        accent: {
          DEFAULT: '#6366f1',
          hover: '#818cf8',
          muted: '#4f46e5',
        },
      },
    },
  },
  plugins: [],
}
