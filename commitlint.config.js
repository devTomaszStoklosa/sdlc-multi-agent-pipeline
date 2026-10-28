// Conventional Commits with a mandatory issue reference (QG-9.14, FR-4.9).
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "references-empty": [2, "never"],
  },
};
