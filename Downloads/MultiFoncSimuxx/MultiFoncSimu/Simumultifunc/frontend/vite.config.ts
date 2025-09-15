// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
    server: {
        host: '0.0.0.0',
        port: 3002,
        allowedHosts: [
            'localhost',
            '.loca.lt',
            '.ngrok-free.app',
            '.ngrok.io',
            '.ngrok.app'
        ],
        proxy: {
            "/api": {
                target: "http://localhost:8877",
                changeOrigin: true,
                ws: true,
                secure: false,
                // 🔧 CORRECTION : Rewrite pour supprimer /api en double
                rewrite: (path) => path.replace(/^\/api/, ''),
                // 🎯 Debug pour voir ce qui se passe
                configure: (proxy) => {
                    proxy.on('proxyReq', (proxyReq, req) => {
                        console.log(`🔄 Proxy: ${req.method} ${req.url} → http://localhost:8877${proxyReq.path}`);
                    });
                    proxy.on('error', (err) => {
                        console.error('❌ Proxy error:', err);
                    });
                }
            },
        },
    },
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "src"),
        },
    },
    plugins: [react()],
});