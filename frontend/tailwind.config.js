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
        coal: "#0f172a",
        mist: "#f4f8fc",
        line: "#d7e3f2",
        ink: "#102033",
        muted: "#64748b",
        accent: "#2563eb"
      },
      boxShadow: {
        panel: "0 24px 64px -48px rgba(15, 23, 42, 0.28)"
      }
    }
  },
  plugins: []
};
