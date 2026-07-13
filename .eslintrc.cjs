/** @type {import('eslint').Linter.Config} */
// ponytail: minimal gate — parser + recommended, noisy rules off. Tighten later.
module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: { ecmaVersion: 2022, sourceType: "module", ecmaFeatures: { jsx: true } },
  env: { browser: true, node: true, es2022: true },
  ignorePatterns: ["build/", "node_modules/", ".cache/"],
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
  plugins: ["@typescript-eslint"],
  rules: {
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-non-null-assertion": "off",
    "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    "no-unused-vars": "off",
  },
};
