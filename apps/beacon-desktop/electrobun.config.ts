import type { ElectrobunConfig } from "electrobun"

export default {
  app: {
    name: "Kanna Beacon",
    identifier: "dev.kanna.beacon",
    version: "0.0.0-kanna",
    urlSchemes: ["kanna-beacon"],
    description: "Lets your Kanna agent read the folders you choose on this computer.",
  },
  runtime: {
    exitOnLastWindowClosed: false,
  },
  release: {
    baseUrl: "https://github.com/cuongtranba/kanna/releases/latest/download",
    generatePatch: false,
  },
  build: {
    mainProcess: "bun",
    bun: {
      entrypoint: "src/main.js",
    },
    views: {
      main: {
        entrypoint: "src/view.js",
      },
    },
    copy: {
      "src/index.html": "views/main/index.html",
      "src/beacon-desktop.css": "views/main/beacon-desktop.css",
      "src/fonts/bricolage-grotesque-latin-wght-normal.woff2": "views/main/fonts/bricolage-grotesque-latin-wght-normal.woff2",
      "src/open-link.js": "bun/open-link.js",
      "assets/tray-online.png": "views/assets/tray-online.png",
      "assets/tray-idle.png": "views/assets/tray-idle.png",
      "assets/tray-online.ico": "views/assets/tray-online.ico",
      "assets/tray-idle.ico": "views/assets/tray-idle.ico",
    },
    mac: {
      bundleCEF: false,
    },
    linux: {
      bundleCEF: false,
    },
    win: {
      bundleCEF: false,
      icon: "assets/icon.ico",
    },
  },
} satisfies ElectrobunConfig
