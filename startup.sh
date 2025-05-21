#!/bin/bash

# Enable error logging
set -e
exec 2> >(tee -a /var/log/cnc-dashboard.error.log)

echo "Starting CNC Dashboard service..."

# Wait for network to be available
echo "Waiting for network..."
sleep 30

# Navigate to the project directory
echo "Navigating to project directory..."
cd /home/cv/cnc-dashboard

# Pull latest changes from git
echo "Pulling latest changes from git..."
git pull origin main

# Start the Docker containers
echo "Starting Docker containers..."
docker-compose down
docker-compose up --build -d

# Print the URL
IP=$(hostname -I | awk '{print $1}')
echo "=================================================="
echo "=== Server is running! Access it at: http://$IP:8000 ==="
echo "==================================================" 