/** @type {import('@types/eslint').Linter.BaseConfig} */
module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: { ecmaVersion: "latest", sourceType: "module", ecmaFeatures: { jsx: true } },
  env: { browser: true, node: true, es2022: true },
  plugins: ["@typescript-eslint", "react", "react-hooks", "jsx-a11y", "import"],
  extends: [
    "eslint:recommended",
    "plugin:react/recommended",
    "plugin:react/jsx-runtime",
    "plugin:react-hooks/recommended",
    "plugin:jsx-a11y/recommended",
    "plugin:@typescript-eslint/recommended",
    "prettier",
  ],
  settings: { react: { version: "detect" }, "import/resolver": { typescript: {} } },
  globals: { shopify: "readonly" },
  rules: {
    "react/prop-types": "off",
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    // Crashes under the repo-wide "minimatch": "9.0.5" override (calls minimatch's old default export).
    "jsx-a11y/label-has-associated-control": "off",
    // Rules that fire on existing code after leaving @remix-run/eslint-config; warnings until the screens are rebuilt.
    "no-empty": "warn",
    "jsx-a11y/no-static-element-interactions": "warn",
    "jsx-a11y/click-events-have-key-events": "warn",
    "react/no-unknown-property": "warn",
    "react/no-unescaped-entities": "warn",
    "prefer-const": "warn",
    "no-var": "warn",
    "jsx-a11y/no-noninteractive-tabindex": "warn",
    "jsx-a11y/no-noninteractive-element-interactions": "warn",
    "jsx-a11y/html-has-lang": "warn",
    "@typescript-eslint/no-unused-expressions": "warn",
  },
  ignorePatterns: ["build/", ".react-router/", "node_modules/", "extensions/**/dist/"],
};
