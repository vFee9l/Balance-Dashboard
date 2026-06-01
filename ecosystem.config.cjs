require("dotenv").config({ path: __dirname + "/.env" });

module.exports = {
  apps: [
    {
      name: "balance-alert",
      script: "./artifacts/api-server/dist/index.mjs",
      interpreter: "node",
      env: {
        NODE_ENV: process.env.NODE_ENV || "production",
        PORT: process.env.PORT || "3030",
        BASE_PATH: process.env.BASE_PATH || "/",
        DATABASE_URL: process.env.DATABASE_URL,
        SESSION_SECRET: process.env.SESSION_SECRET,
        FRONTEND_DIST: process.env.FRONTEND_DIST,
      },
    },
  ],
};
