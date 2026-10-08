// @hutch cli=0.27.1 cottontail=0.7.1
export default {
  scripts: {
    build: ["hutch", "electrobun", "build", "--env=stable"],
    "build:dev": ["hutch", "electrobun", "build", "--env=dev"],
  },
  electrobun: {
    version: "2.0.2",
  },
}
