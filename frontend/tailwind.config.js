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
        mist: "#f5f8ff",
        line: "#d7e5f7",
        ink: "#1d2430",
        muted: "#667085",
        accent: "#2563eb"
      },
      boxShadow: {
        panel: "0 24px 64px -42px rgba(37, 99, 235, 0.20)",
        raised: "0 18px 46px -34px rgba(37, 99, 235, 0.44)"
      }
    }
  },
  plugins: []
};
