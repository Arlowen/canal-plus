/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["HarmonyOS Sans SC", "MiSans", "PingFang SC", "Noto Sans SC Variable", "ui-sans-serif", "system-ui"],
        mono: ["JetBrains Mono", "SFMono-Regular", "ui-monospace", "monospace"]
      },
      colors: {
        coal: "#0b1220",
        mist: "#f6f9ff",
        line: "#d8e2f0",
        ink: "#172033",
        muted: "#64748b",
        accent: "#0052ff"
      },
      boxShadow: {
        panel: "0 1px 2px rgba(11, 18, 32, 0.04), 0 18px 42px -38px rgba(0, 82, 255, 0.28)",
        raised: "0 10px 24px -20px rgba(0, 82, 255, 0.48)"
      }
    }
  },
  plugins: []
};
