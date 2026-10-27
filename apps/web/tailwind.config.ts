import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: "#edf2f7",
        muted: "#94a3b1",
        canvas: "#0b1117",
        line: "#27333e",
        accent: "#ff784f",
        mint: "#55d6b0",
      },
      boxShadow: { panel: "0 20px 60px rgba(0, 0, 0, 0.25)" },
    },
  },
  plugins: [],
};

export default config;
