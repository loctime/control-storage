#!/bin/bash

# Script para instalar FFmpeg en Render
echo "🔧 Instalando FFmpeg..."

# Actualizar paquetes del sistema
apt-get update

# Instalar FFmpeg
apt-get install -y ffmpeg

# Verificar instalación
ffmpeg -version

echo "✅ FFmpeg instalado correctamente"
