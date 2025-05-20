# CNC Runtime Dashboard

A real-time dashboard for monitoring CNC machine states using ArUco/AprilTag detection.

## Prerequisites

- Docker and Docker Compose installed
- Webcam connected to the device
- Git (optional, for cloning the repository)

## Installation

1. Clone the repository (or download the files):
   ```bash
   git clone <your-repository-url>
   cd cnc-dashboard
   ```

2. Build and start the Docker container:
   ```bash
   docker-compose up --build
   ```

3. Access the dashboard:
   Open your web browser and navigate to:
   ```
   http://localhost:5000
   ```

## Configuration

### Camera Selection
To change the camera index, modify the `detector.py` file:
```python
cap = cv2.VideoCapture(0, cv2.CAP_DSHOW)  # Change 0 to your desired camera index
```

### Port Configuration
To change the port, modify the `docker-compose.yml` file:
```yaml
ports:
  - "YOUR_PORT:5000"
```

## Troubleshooting

### Camera Access Issues
If the camera isn't working:
1. Check if the camera is properly connected
2. Verify the camera index in `detector.py`
3. Ensure the camera device is properly mounted in Docker:
   ```bash
   ls -l /dev/video*
   ```

### Container Issues
To view container logs:
```bash
docker-compose logs
```

To restart the container:
```bash
docker-compose restart
```

## Development

The application is mounted as a volume, so changes to the code will be reflected immediately (after container restart).

## License

[Your License Here] 