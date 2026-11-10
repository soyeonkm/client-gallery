export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        paper: '#FAF8F5',
        line: '#E7E2DA',
        ink: { DEFAULT: '#1C1B19', soft: '#57534E', muted: '#8A8580' },
        bean: { DEFAULT: '#5B4232', dark: '#46321F' },
      },
      fontFamily: {
        serif: ['"Cormorant Garamond"', 'Georgia', 'serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
