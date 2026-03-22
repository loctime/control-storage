/** @type {import('vitest').UserConfig} */
export default {
  test: {
    environment: "node",
    include: ["src/**/*.test.js"],
    globals: true,
  },
};
