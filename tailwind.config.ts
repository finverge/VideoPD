import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          50: "#f4f6fb",
          100: "#e7ebf6",
          200: "#c7d1e8",
          300: "#9caed3",
          400: "#6c84b8",
          500: "#4a629d",
          600: "#374c81",
          700: "#2b3c68",
          800: "#1c2847",
          900: "#0f1730",
          950: "#080d1c",
        },
        sprout: {
          50: "#eefdf6",
          100: "#d5f9e8",
          200: "#aef1d3",
          300: "#74e3b6",
          400: "#3ecd97",
          500: "#1cb27d",
          600: "#128f66",
          700: "#117254",
          800: "#125b45",
          900: "#114b3a",
          950: "#062a20",
        },
        amber: {
          50: "#fffbeb",
          100: "#fef3c7",
          200: "#fde28a",
          300: "#fbcb4c",
          400: "#f9b429",
          500: "#f2960f",
          600: "#d6740a",
          700: "#b1530c",
          800: "#8f4110",
          900: "#763710",
        },
        canvas: {
          light: "#f7f8fc",
          dark: "#0a0f1f",
        },
      },
      fontFamily: {
        sans: [
          "var(--font-jakarta)",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
      },
      borderRadius: {
        "4xl": "2rem",
      },
      boxShadow: {
        soft: "0 2px 8px -2px rgb(15 23 48 / 0.08), 0 1px 2px -1px rgb(15 23 48 / 0.06)",
        lift: "0 12px 32px -8px rgb(15 23 48 / 0.18), 0 4px 12px -4px rgb(15 23 48 / 0.10)",
        glow: "0 0 0 1px rgb(28 178 125 / 0.15), 0 8px 24px -6px rgb(28 178 125 / 0.35)",
      },
      backgroundImage: {
        "grid-fade":
          "radial-gradient(ellipse 80% 50% at 50% -20%, rgb(28 178 125 / 0.15), transparent)",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "pulse-ring": {
          "0%": { transform: "scale(0.9)", opacity: "0.7" },
          "70%": { transform: "scale(1.6)", opacity: "0" },
          "100%": { transform: "scale(1.6)", opacity: "0" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.5s cubic-bezier(0.16,1,0.3,1) both",
        "pulse-ring": "pulse-ring 1.6s cubic-bezier(0.4,0,0.6,1) infinite",
        shimmer: "shimmer 2.5s linear infinite",
      },
    },
  },
  plugins: [],
};

export default config;
