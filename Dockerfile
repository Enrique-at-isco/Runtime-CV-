# Use Python 3.9 slim as base image
FROM python:3.9-slim

# Install system dependencies required for OpenCV and Node.js
RUN apt-get update && apt-get install -y \
    libgl1-mesa-glx \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libgl1-mesa-dev \
    curl \
    gnupg \
    v4l-utils \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 20 LTS
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get update \
    && apt-get install -y nodejs \
    && npm install -g npm@latest

# Set working directory
WORKDIR /app

# Copy package files first
COPY package*.json ./

# Install Node.js dependencies
RUN npm install

# Copy requirements and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application
COPY . .

# Create necessary directories
RUN mkdir -p static/css static/js

# Build frontend assets (if needed)
RUN npm run build || true

# Expose port 5000 for Flask
EXPOSE 5000

# Command to run the application
CMD ["flask", "run", "--host=0.0.0.0"] 