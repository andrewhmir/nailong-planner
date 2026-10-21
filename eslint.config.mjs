import next from "eslint-config-next/core-web-vitals";

const config = [
  ...next,
  {
    ignores: [
      ".next/**",
      ".next-e2e/**",
      "node_modules/**",
      "out/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      ".playwright/**",
      ".superpowers/**",
      "next-env.d.ts",
    ],
  },
];

export default config;
