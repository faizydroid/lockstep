/**
 * Tailwind v4 is a PostCSS plugin and takes no JS config file.
 *
 * The design tokens live in `src/app/globals.css` under `@theme`, which is v4's CSS-first
 * configuration. There is deliberately no tailwind.config.js.
 */
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
