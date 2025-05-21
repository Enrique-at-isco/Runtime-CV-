#!/bin/bash

# Wait for network to be available
sleep 30

# Navigate to the project directory
cd /home/pi/cnc-dashboard

# Pull latest changes from git
git pull origin main

# Start the Docker containers
docker-compose down
docker-compose up --build -d

# Print the URL
IP=$(hostname -I | awk '{print $1}')
echo "=================================================="
echo "=== Server is running! Access it at: http://$IP:8000 ==="
echo "==================================================" 