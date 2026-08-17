import reactHooks from "eslint-plugin-react-hooks";
import tsParser from "@typescript-eslint/parser";

/**
 * Two rules, and nothing else.
 *
 * This project had no linter, which is how a hooks-order violation reached
 * production and took the app down with "a client-side exception has occurred": a
 * weather hook sat below `if (!data) return <Loading/>`, so it ran on the second
 * render and not the first. TypeScript cannot see that. `next build` cannot see it.
 * The only thing that catches it is `react-hooks/rules-of-hooks`, and it catches it
 * instantly.
 *
 * Deliberately not a style config. A linter that reports two hundred formatting
 * opinions on its first run is a linter that gets muted, and then the one rule that
 * would have prevented an outage is muted along with it. If more rules earn their
 * place later they can be added one at a time, each with a reason.
 *
 * `exhaustive-deps` is a warning rather than an error: a missing dependency is
 * usually a bug and occasionally a deliberate choice, so it should be visible without
 * being able to fail a build on its own.
 */
export default [
  {
    files: ["**/*.{ts,tsx}"],
    ignores: ["node_modules/**", ".next/**", "tests/**", "scripts/**"],
    plugins: {
      "react-hooks": reactHooks,
      /*
       * A stub for Next's own plugin.
       *
       * The components carry `eslint-disable-next-line @next/next/no-img-element`
       * comments, which are correct for the linter Next runs and read as "rule not
       * found" errors here. Declaring the namespace with no rules in it makes those
       * comments inert instead of fatal, without pulling in a plugin this config has
       * no other use for.
       */
      "@next/next": {
        // Defined as a no-op, because ESLint wants the named rule to exist before it
        // will accept a comment disabling it. It reports nothing; Next's own linter
        // still reports it for real when the project runs that.
        rules: { "no-img-element": { create: () => ({}) } },
      },
    },
    languageOptions: {
      // The TypeScript parser, because the default one stops at the first `type`
      // keyword and reports 180 parsing errors instead of linting anything.
      parser: tsParser,
      parserOptions: { ecmaFeatures: { jsx: true }, sourceType: "module" },
    },
    linterOptions: {
      /*
       * Existing `eslint-disable` comments name Next's own rules, which this config
       * does not load — so they read as "rule not found" errors and drown the two
       * rules that matter. Not an error and not removed: they are correct comments
       * for the linter Next runs, and deleting them would break that.
       */
      reportUnusedDisableDirectives: false,
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
];
