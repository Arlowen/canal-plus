/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Geist", "Satoshi", "Avenir Next", "ui-sans-serif", "system-ui"],
        mono: ["JetBrains Mono", "SFMono-Regular", "ui-monospace", "monospace"]
      },
      colors: {
        coal: "#141820",
        mist: "#f6f7f9",
        line: "#d8dee8",
        ink: "#1d2430",
        muted: "#667085",
        accent: "#0f766e"
      },
      boxShadow: {
        panel: "0 24px 64px -42px rgba(20, 24, 32, 0.28)",
        raised: "0 18px 46px -34px rgba(20, 24, 32, 0.42)"
      }
    }
  },
  plugins: []
};
