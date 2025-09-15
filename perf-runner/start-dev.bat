# start-dev.bat (Windows)
@echo off
echo 🚀 Démarrage automatique EVSE Simulator...

echo 📦 1. Démarrage du frontend (avec proxy automatique)...
start "EVSE Frontend" npm run dev

echo ⏳ Attente 3 secondes...
timeout 3

echo 🌐 2. Création du tunnel ngrok...
echo.
echo ✅ URL publique disponible ci-dessous :
echo.
ngrok http 3002

# start-dev.sh (Linux/Mac)
#!/bin/bash
echo "🚀 Démarrage automatique EVSE Simulator..."
echo "📦 1. Démarrage du frontend (avec proxy automatique)..."
npm run dev &
echo "⏳ Attente 3 secondes..."
sleep 3
echo "🌐 2. Création du tunnel ngrok..."
echo ""
echo "✅ URL publique disponible ci-dessous :"
echo ""
ngrok http 3002