/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // ChatGPT のダークテーマに合わせたカラーパレット
        chatgpt: {
          bg: '#212121',
          surface: '#2f2f2f',
          border: '#444444',
          text: '#ececec',
          muted: '#8e8ea0',
          accent: '#10a37f',
          accentHover: '#1a7f64',
        },
      },
    },
  },
  plugins: [],
}
