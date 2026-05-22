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
        coal: "#18181b",
        mist: "#f7f7f4",
        line: "#deded8",
        ink: "#27272a",
        muted: "#71717a",
        accent: "#13795b"
      },
      boxShadow: {
        panel: "0 24px 60px -42px rgba(24, 24, 27, 0.45)"
      }
    }
  },
  plugins: []
};
