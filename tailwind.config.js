module.exports = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ['Poppins', 'sans-serif'],
        body: ['Inconsolata', 'monospace'],
      },
      colors: {
        trips: {
          1: '#002348',
          2: '#467494',
          3: '#F87151',
          4: '#F2F3F4',
          5: '#46749499'
        },
        chess: {
          light: '#f0d9b5',
          dark: '#b58863',
          highlight: '#ffff00',
          check: '#ff6b6b'
        },
        gray: {
          100: '#edece9',
          200: '#eeeeee',
          300: '#e0e0e0',
          400: '#bdbdbd',
          500: '#9e9e9e',
          600: '#757575',
          700: '#616161',
          800: '#424242',
          900: '#161619',
          1000: '#0e0e0e',
        },
        blue: {
          1: "#1B2837",
          2: "#2F4660",
          3: "#0F2854",
          4: "#42648A",
          5: "#456990",
          6: "#467494",
        }
      },
      minHeight: {
        0: '0',
        45: '45px',
        '1/4': '25vh',
        '1/2': '50vh',
        '3/4': '75vh',
        full: '100vh',
      },
    },
  },
  plugins: [],
}
