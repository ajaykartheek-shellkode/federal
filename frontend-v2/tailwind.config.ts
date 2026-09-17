import type { Config } from "tailwindcss";

/**
 * Federal Bank theme for GL Portal.
 * Brand: royal blue #004E96 (trust) + chrome/amber yellow #FAA619 (success), navy #082461,
 * warm cream #FFF6E7, Titillium Web typography, generous radii and soft blue-tinted shadows.
 */
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#EEF4FB",
          100: "#DCE8F6",
          200: "#B6CFEC",
          300: "#80AADB",
          400: "#3F7BC4",
          500: "#1363B3",
          600: "#004E96",
          700: "#003F7C",
          800: "#073268",
          900: "#082461",
          950: "#051A45",
        },
        gold: {
          50: "#FFF9EE",
          100: "#FFF1D6",
          200: "#FFE1AA",
          300: "#FDCB6E",
          400: "#FBB741",
          500: "#FAA619",
          600: "#E08D00",
          700: "#B26E00",
        },
        cream: "#FFF6E7",
        canvas: "#F3F6FA",
        surface: "#FFFFFF",
        subtle: "#F7F9FC",
        line: { DEFAULT: "#E3E8F0", strong: "#CBD5E2" },
        ink: { DEFAULT: "#15223A", 2: "#414B5C", muted: "#6F7B8F", faint: "#A2ACBC" },
        ok: { DEFAULT: "#0E9258", soft: "#E6F5EE", line: "#B8E2CD" },
        warn: { DEFAULT: "#C26A00", soft: "#FFF3E0", line: "#F6D6A4" },
        bad: { DEFAULT: "#D0342C", soft: "#FDEDEC", line: "#F4C3BF" },
      },
      fontFamily: {
        sans: ["var(--font-titillium)", "Titillium Web", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        mono: ["ui-monospace", "SF Mono", "Menlo", "Consolas", "monospace"],
      },
      fontSize: {
        "2xs": ["10px", "14px"],
        xs: ["11.5px", "16px"],
        sm: ["13px", "19px"],
        base: ["14px", "21px"],
      },
      borderRadius: {
        sm: "6px",
        md: "10px",
        lg: "14px",
        xl: "18px",
        "2xl": "24px",
        "3xl": "32px",
      },
      boxShadow: {
        xs: "0 1px 2px rgba(8,36,97,0.05)",
        card: "0 1px 2px rgba(8,36,97,0.04), 0 6px 20px -6px rgba(8,36,97,0.10)",
        raised: "0 2px 4px rgba(8,36,97,0.05), 0 14px 36px -10px rgba(8,36,97,0.18)",
        lift: "0 24px 64px -16px rgba(8,36,97,0.35)",
        focus: "0 0 0 3px rgba(0,78,150,0.18)",
        gold: "0 8px 22px -8px rgba(224,141,0,0.55)",
      },
      backgroundImage: {
        "brand-hero": "linear-gradient(125deg, #082461 0%, #003F7C 45%, #004E96 100%)",
        "brand-rail": "linear-gradient(180deg, #082461 0%, #06285F 55%, #004E96 140%)",
        "gold-sheen": "linear-gradient(120deg, #FBB741 0%, #FAA619 50%, #E08D00 100%)",
      },
      keyframes: {
        "word-in": { from: { opacity: "0", filter: "blur(2px)" }, to: { opacity: "1", filter: "blur(0)" } },
        shimmer: { "0%": { backgroundPosition: "-200% 0" }, "100%": { backgroundPosition: "200% 0" } },
        "pulse-ring": {
          "0%": { boxShadow: "0 0 0 0 rgba(250,166,25,0.55)" },
          "70%": { boxShadow: "0 0 0 8px rgba(250,166,25,0)" },
          "100%": { boxShadow: "0 0 0 0 rgba(250,166,25,0)" },
        },
        "flash-gold": { "0%": { backgroundColor: "rgba(250,166,25,0.18)" }, "100%": { backgroundColor: "transparent" } },
        "bounce-dot": { "0%, 80%, 100%": { transform: "translateY(0)", opacity: "0.45" }, "40%": { transform: "translateY(-4px)", opacity: "1" } },
      },
      animation: {
        "word-in": "word-in 320ms ease-out both",
        shimmer: "shimmer 1.6s linear infinite",
        "pulse-ring": "pulse-ring 1.8s cubic-bezier(0.4,0,0.6,1) infinite",
        "flash-gold": "flash-gold 1.6s ease-out",
        "bounce-dot": "bounce-dot 1.2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
