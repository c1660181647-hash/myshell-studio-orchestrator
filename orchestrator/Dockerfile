# --- Stage 1: Build frontend ---
FROM node:20-slim AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci --no-audit --no-fund 2>/dev/null || npm install
COPY frontend/ ./
RUN npx vite build

# --- Stage 2: Python backend + Headless Chrome ---
FROM python:3.11-slim

# Install system deps first
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget gnupg ca-certificates curl fonts-liberation \
    libnss3 libxss1 libasound2 libatk-bridge2.0-0 libgtk-3-0 \
    libdrm2 libgbm1 libx11-xcb1 libxcomposite1 libxdamage1 \
    libxrandr2 xdg-utils

# Add Chrome repo (new GPG method, no apt-key)
RUN wget -q -O /tmp/chrome-key.pub https://dl.google.com/linux/linux_signing_key.pub \
    && gpg --dearmor < /tmp/chrome-key.pub > /usr/share/keyrings/google-chrome.gpg \
    && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update && apt-get install -y --no-install-recommends google-chrome-stable \
    && apt-get clean && rm -rf /var/lib/apt/lists/* /tmp/chrome-key.pub

WORKDIR /app

# Install Python dependencies
COPY orchestrator/backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend code
COPY orchestrator/backend/ ./

# Copy built frontend and route source used by readiness coverage
COPY --from=frontend-build /app/frontend/dist /app/frontend/dist
COPY --from=frontend-build /app/frontend/src/App.tsx /app/frontend/src/App.tsx

# Copy startup script
COPY orchestrator/start-cloud.sh /app/start-cloud.sh
RUN chmod +x /app/start-cloud.sh

# Create directories
RUN mkdir -p /app/frontend/dist/generated /app/chrome-data

ENV PORT=8080
EXPOSE 8080

CMD ["/app/start-cloud.sh"]
