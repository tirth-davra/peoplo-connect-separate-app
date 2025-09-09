const colors = require('tailwindcss/colors')

module.exports = {
  content: [
    './renderer/pages/**/*.{js,ts,jsx,tsx}',
    './renderer/components/**/*.{js,ts,jsx,tsx}',
  ],
  darkMode: 'media', // Enable system-based dark mode detection
  theme: {
    colors: {
      // use colors only specified
      white: colors.white,
      gray: colors.gray,
      blue: colors.blue,
      green: colors.green,
      red: colors.red,
      yellow: colors.yellow,
      purple: colors.purple,
      pink: colors.pink,
      orange: colors.orange,
      teal: colors.teal,
      cyan: colors.cyan,
      indigo: colors.indigo,
      amber: colors.amber,
      emerald: colors.emerald,
      rose: colors.rose,
      sky: colors.sky,
      violet: colors.violet,
      fuchsia: colors.fuchsia,
      slate: colors.slate,
      lime: colors.lime,
      black: colors.black,
      transparent: 'transparent',
      // Custom brand colors
      primary: {
        50: '#f0fdfc',
        100: '#ccfbf7',
        200: '#99f6f0',
        300: '#5eede6',
        400: '#2dd9d4',
        500: '#10C3BD', // Primary teal color
        600: '#0e9f9a',
        700: '#0f7e7b',
        800: '#115e5c',
        900: '#134e4a',
      },
      accent: {
        50: '#fff7ed',
        100: '#ffedd5',
        200: '#fed7aa',
        300: '#fdba74',
        400: '#fb923c',
        500: '#F27721', // Accent orange color
        600: '#ea580c',
        700: '#c2410c',
        800: '#9a3412',
        900: '#7c2d12',
      },
    },
    extend: {
      boxShadow: {
        'primary': '0 4px 14px 0 rgba(16, 195, 189, 0.25)',
        'accent': '0 4px 14px 0 rgba(242, 119, 33, 0.25)',
        'primary-lg': '0 10px 25px -3px rgba(16, 195, 189, 0.3), 0 4px 6px -2px rgba(16, 195, 189, 0.1)',
        'accent-lg': '0 10px 25px -3px rgba(242, 119, 33, 0.3), 0 4px 6px -2px rgba(242, 119, 33, 0.1)',
      },
    },
  },
  plugins: [],
}
