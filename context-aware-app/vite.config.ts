import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import obfuscatorPlugin from "rollup-plugin-obfuscator";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;
// @ts-expect-error process is a nodejs global
const isProd = process.env.NODE_ENV === "production";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 4001,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
        protocol: "ws",
        host,
        port: 1421,
      }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },

  // 生产环境代码混淆
  build: {
    minify: "terser",
    terserOptions: {
      compress: {
        drop_console: false,  // 保留console以便调试
        drop_debugger: false,  // 保留debugger以便调试
      },
    },
    rollupOptions: {
      // @ts-expect-error obfuscator plugin types
      plugins: isProd
        ? [
          obfuscatorPlugin({
            options: {
              compact: true,
              controlFlowFlattening: true,
              controlFlowFlatteningThreshold: 0.75,
              deadCodeInjection: true,
              deadCodeInjectionThreshold: 0.4,
              debugProtection: false,
              disableConsoleOutput: true,
              identifierNamesGenerator: "hexadecimal",
              renameGlobals: false,
              rotateStringArray: true,
              selfDefending: true,
              shuffleStringArray: true,
              splitStrings: true,
              splitStringsChunkLength: 10,
              stringArray: true,
              stringArrayEncoding: ["base64"],
              stringArrayThreshold: 0.75,
              transformObjectKeys: true,
              unicodeEscapeSequence: false,
            },
          }),
        ]
        : [],
    },
  },
});
