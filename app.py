from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
import sqlite3
from datetime import datetime, timedelta
import json
import csv
from io import StringIO
from typing import Dict, List, Optional
from fastapi.responses import StreamingResponse
import os
import socket
from apriltag_detector import ArUcoStateDetector
import cv2
import numpy as np
import time
import asyncio
import subprocess
import sys
from collections import defaultdict

app = FastAPI()

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins
    allow_credentials=True,
    allow_methods=["*"],  # Allows all methods
    allow_headers=["*"],  # Allows all headers
)

def detect_available_cameras() -> list:
    """Detect Logitech BRIO or first available camera using v4l2-ctl and OpenCV."""
    max_devices = 40
    brio_device = None
    generic_device = None
    print("\n===== ENVIRONMENT DIAGNOSTICS =====")
    print(f"User ID: {os.getuid()}  Effective User ID: {os.geteuid()}")
    print(f"Python version: {sys.version}")
    print(f"Environment: {os.environ}")
    print("Sleeping 5 seconds before camera detection...")
    time.sleep(5)
    print("Scanning for Logitech BRIO and available cameras...")
    for i in range(max_devices):
        dev = f"/dev/video{i}"
        try:
            print(f"\n--- Checking {dev} ---")
            result = subprocess.run([
                "v4l2-ctl", "--device", dev, "--all"
            ], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            print(f"v4l2-ctl output for {dev}:\n{result.stdout}\n{result.stderr}")
            if "Logitech BRIO" in result.stdout:
                print(f"Found Logitech BRIO at {dev}")
                cap = cv2.VideoCapture(dev)
                print(f"  cap.isOpened(): {cap.isOpened()}")
                if cap.isOpened():
                    ret, frame = cap.read()
                    print(f"  ret from cap.read(): {ret}")
                    if ret:
                        print(f"  {dev} is a working Logitech BRIO video capture device!")
                        cap.release()
                        brio_device = dev
                        break
                    cap.release()
        except Exception as e:
            print(f"  Error checking {dev}: {e}")
            continue
    if brio_device:
        return [brio_device]
    # Fallback: return first working video device
    for i in range(max_devices):
        dev = f"/dev/video{i}"
        print(f"\n--- Checking {dev} (generic fallback) ---")
        cap = cv2.VideoCapture(dev)
        print(f"  cap.isOpened(): {cap.isOpened()}")
        if cap.isOpened():
            ret, frame = cap.read()
            print(f"  ret from cap.read(): {ret}")
            if ret:
                print(f"  {dev} is a working generic video capture device!")
                cap.release()
                generic_device = dev
                break
            cap.release()
    if generic_device:
        return [generic_device]
    print("No working camera found.")
    return []

def initialize_camera(camera_index: Optional[str] = None) -> bool:
    """Initialize camera with the given device path or automatically select one if not specified."""
    global detector, camera_id
    try:
        if camera_index is None:
            # Auto-detect available cameras
            available_cameras = detect_available_cameras()
            if not available_cameras:
                print("No cameras found!")
                return False
            camera_id = available_cameras[0]
            print(f"Automatically selected camera {camera_id}")
        else:
            camera_id = camera_index
        detector = ArUcoStateDetector(camera_id)
        return True
    except Exception as e:
        print(f"Error initializing camera: {e}")
        return False

# Initialize camera and detector
camera = None
detector = None
camera_id = None

# Equipment name storage
EQUIPMENT_NAME_FILE = "equipment_name.txt"

# Service discovery
SERVICE_REGISTRY_FILE = "data/service_registry.json"

# Global variables
current_state = 'IDLE'
last_tag_id = None
state_start_time = None

# WebSocket connection manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        for connection in self.active_connections:
            await connection.send_json(message)

manager = ConnectionManager()

def get_service_registry() -> Dict:
    """Get the current service registry."""
    try:
        if os.path.exists(SERVICE_REGISTRY_FILE):
            with open(SERVICE_REGISTRY_FILE, 'r') as f:
                return json.load(f)
    except Exception:
        pass
    return {"services": []}

def save_service_registry(registry: Dict) -> None:
    """Save the service registry."""
    os.makedirs(os.path.dirname(SERVICE_REGISTRY_FILE), exist_ok=True)
    with open(SERVICE_REGISTRY_FILE, 'w') as f:
        json.dump(registry, f, indent=2)

@app.get("/api/discovery/register")
async def register_service():
    """Register this service in the cluster."""
    try:
        registry = get_service_registry()
        service_info = {
            "id": socket.gethostname(),
            "ip": get_ip(),
            "port": 8000,
            "name": get_equipment_name(),
            "last_seen": datetime.now().isoformat()
        }
        
        # Update or add service
        services = registry.get("services", [])
        for i, service in enumerate(services):
            if service["id"] == service_info["id"]:
                services[i] = service_info
                break
        else:
            services.append(service_info)
        
        registry["services"] = services
        save_service_registry(registry)
        return service_info
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"error": str(e)}
        )

@app.get("/api/discovery/services")
async def list_services():
    """List all registered services in the cluster."""
    try:
        registry = get_service_registry()
        # Filter out services that haven't been seen in the last 5 minutes
        now = datetime.now()
        active_services = [
            service for service in registry.get("services", [])
            if (now - datetime.fromisoformat(service["last_seen"])).total_seconds() < 300
        ]
        return {"services": active_services}
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"error": str(e)}
        )

def get_equipment_name() -> str:
    """Get the current equipment name."""
    try:
        if os.path.exists(EQUIPMENT_NAME_FILE):
            with open(EQUIPMENT_NAME_FILE, 'r') as f:
                return f.read().strip()
    except Exception:
        pass
    return "CNC Machine"  # Default name

def save_equipment_name(name: str) -> None:
    """Save the equipment name."""
    with open(EQUIPMENT_NAME_FILE, 'w') as f:
        f.write(name)

@app.get("/api/equipment/name")
async def get_equipment_name_endpoint():
    """Get the current equipment name."""
    return {"name": get_equipment_name()}

@app.post("/api/equipment/name")
async def update_equipment_name(name: Dict[str, str]):
    """Update the equipment name."""
    try:
        new_name = name.get("name", "").strip()
        if not new_name:
            return JSONResponse(
                status_code=400,
                content={"error": "Equipment name cannot be empty"}
            )
        save_equipment_name(new_name)
        return {"status": "success", "name": new_name}
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"error": str(e)}
        )

# Function to get IP address
def get_ip():
    try:
        # Get the first non-localhost IP address
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except:
        return "localhost"

def save_state_change(state: str, duration: float, description: str = None, tag_id: int = None):
    db = get_db()
    cursor = db.cursor()
    # Update the previous state's duration if duration > 0
    if duration > 0:
        cursor.execute('''
            UPDATE state_changes
            SET duration = ?
            WHERE id = (SELECT id FROM state_changes ORDER BY timestamp DESC LIMIT 1)
        ''', (duration,))
        db.commit()
    # Insert the new state (duration 0 for now, will be updated on next state change)
    cursor.execute('''
        INSERT INTO state_changes (timestamp, state, description, tag_id, duration)
        VALUES (?, ?, ?, ?, ?)
    ''', (datetime.now().isoformat(), state, description, tag_id, 0.0))
    db.commit()

@app.on_event("startup")
async def startup_event():
    ip = get_ip()
    url = f'http://{ip}:8000'
    print("\n" + "="*50)
    print(f"=== Server is running! Access it at: {url} ===")
    print("="*50 + "\n")
    
    # Initialize camera on startup
    if not initialize_camera():
        print("Warning: Failed to initialize camera. The application will start without camera support.")
    
    # Start camera processing thread
    import threading
    camera_thread = threading.Thread(target=process_camera_feed, daemon=True)
    camera_thread.start()

# Mount static files
app.mount("/static", StaticFiles(directory="static"), name="static")

# Database setup
def get_db():
    db_path = os.getenv('DATABASE_PATH', 'machine_states.db')
    db = sqlite3.connect(db_path)
    db.row_factory = sqlite3.Row
    return db

def init_db():
    db = get_db()
    db.execute('''
        CREATE TABLE IF NOT EXISTS state_changes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            state TEXT NOT NULL,
            description TEXT,
            tag_id INTEGER,
            duration REAL
        )
    ''')
    db.commit()

init_db()

# Helper function to get state counts for a time period
def get_state_counts(start_time: datetime, end_time: datetime) -> Dict:
    db = get_db()
    cursor = db.cursor()
    
    # Get total duration for each state within the time period
    cursor.execute('''
        SELECT 
            state,
            SUM(duration) as total_duration
        FROM state_changes
        WHERE datetime(timestamp) BETWEEN datetime(?) AND datetime(?)
        GROUP BY state
    ''', (start_time.isoformat(), end_time.isoformat()))
    
    results = cursor.fetchall()
    
    # Initialize counts
    counts = {
        'RUNNING': 0,
        'IDLE': 0,
        'ERROR': 0
    }
    
    # Sum up the durations for each state
    for row in results:
        state = row['state']
        if state in counts:
            counts[state] = float(row['total_duration'] or 0)
    
    return counts

@app.get("/")
async def root():
    return FileResponse("static/index.html")

@app.get("/api/metrics/{period}")
async def get_metrics(period: str):
    now = datetime.now()
    # Calculate start time based on period
    if period == "today":
        start_time = now.replace(hour=0, minute=0, second=0, microsecond=0)
    elif period == "week":
        start_time = now - timedelta(days=now.weekday())
        start_time = start_time.replace(hour=0, minute=0, second=0, microsecond=0)
    elif period == "month":
        start_time = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    elif period == "quarter":
        quarter_month = ((now.month - 1) // 3) * 3 + 1
        start_time = now.replace(month=quarter_month, day=1, hour=0, minute=0, second=0, microsecond=0)
    elif period == "year":
        start_time = now.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
    else:
        return JSONResponse(status_code=400, content={"error": "Invalid period"})

    state_counts = get_state_counts(start_time, now)
    total_duration = sum(state_counts.values())
    percentages = {k: round((v / total_duration * 100) if total_duration > 0 else 0, 1) for k, v in state_counts.items()}

    # Hourly metrics for today
    hourly_metrics = None
    if period == "today":
        hourly_metrics = defaultdict(lambda: {"RUNNING": 0, "IDLE": 0, "ERROR": 0})
        db = get_db()
        cursor = db.cursor()
        cursor.execute('''SELECT * FROM state_changes WHERE datetime(timestamp) BETWEEN datetime(?) AND datetime(?)''', (start_time.isoformat(), now.isoformat()))
        rows = cursor.fetchall()
        for row in rows:
            ts = datetime.fromisoformat(row['timestamp'])
            hour = ts.hour
            hourly_metrics[hour][row['state']] += float(row['duration'] or 0)
        hourly_metrics = dict(hourly_metrics)

    # Daily metrics for week/month/quarter/year
    daily_metrics = None
    if period in ["week", "month", "quarter", "year"]:
        daily_metrics = defaultdict(lambda: {"RUNNING": 0, "IDLE": 0, "ERROR": 0})
        db = get_db()
        cursor = db.cursor()
        cursor.execute('''SELECT * FROM state_changes WHERE datetime(timestamp) BETWEEN datetime(?) AND datetime(?)''', (start_time.isoformat(), now.isoformat()))
        rows = cursor.fetchall()
        for row in rows:
            ts = datetime.fromisoformat(row['timestamp'])
            day = ts.date().isoformat()
            daily_metrics[day][row['state']] += float(row['duration'] or 0)
        daily_metrics = dict(daily_metrics)

    # Summary
    summary = {
        'total_runtime': state_counts['RUNNING'],
        'best_day': None,
        'avg_daily_runtime': 0,
        'weekly_efficiency': percentages['RUNNING'],
    }
    if daily_metrics:
        best_day = max(daily_metrics.items(), key=lambda x: x[1]['RUNNING'])[0] if daily_metrics else None
        avg_daily_runtime = sum(day['RUNNING'] for day in daily_metrics.values()) / len(daily_metrics) if daily_metrics else 0
        summary['best_day'] = best_day
        summary['avg_daily_runtime'] = avg_daily_runtime

    return {
        "state_counts": state_counts,
        "percentages": percentages,
        "hourly_metrics": hourly_metrics,
        "daily_metrics": daily_metrics,
        "summary": summary,
        "period": period,
        "start_time": start_time.isoformat(),
        "end_time": now.isoformat()
    }

@app.get("/api/events/today")
async def get_events_today():
    now = datetime.now()
    start_time = now.replace(hour=0, minute=0, second=0, microsecond=0)
    db = get_db()
    cursor = db.cursor()
    cursor.execute('''SELECT * FROM state_changes WHERE datetime(timestamp) BETWEEN datetime(?) AND datetime(?) ORDER BY timestamp ASC''', (start_time.isoformat(), now.isoformat()))
    rows = cursor.fetchall()
    events = []
    for row in rows:
        event = {
            "timestamp": row['timestamp'],
            "state": row['state'],
            "duration": row['duration'],
            "description": row['description'],
            "tag_id": row['tag_id']
        }
        print(f"[EVENT] {event}")
        if event['duration'] == 0.0:
            print(f"[WARNING] Zero duration event: {event}")
        events.append(event)
    return events

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            if data == "get_state":
                # Get the most recent state from the database
                db = get_db()
                cursor = db.cursor()
                cursor.execute('''
                    SELECT * FROM state_changes
                    ORDER BY timestamp DESC
                    LIMIT 1
                ''')
                last_state = cursor.fetchone()
                
                if last_state:
                    await websocket.send_json({
                        "state": last_state["state"],
                        "description": last_state["description"],
                        "timestamp": last_state["timestamp"],
                        "last_tag_id": last_state["tag_id"]
                    })
                else:
                    await websocket.send_json({
                        "state": "IDLE",
                        "description": "No state data available",
                        "timestamp": datetime.now().isoformat(),
                        "last_tag_id": None
                    })
    except WebSocketDisconnect:
        manager.disconnect(websocket)

@app.post("/api/clear_data")
async def clear_data():
    try:
        db = get_db()
        cursor = db.cursor()
        cursor.execute('DELETE FROM state_changes')
        db.commit()
        return {"status": "success", "message": "All data cleared successfully"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.get("/api/export_states")
async def export_states():
    db = get_db()
    cursor = db.cursor()
    cursor.execute('SELECT * FROM state_changes ORDER BY timestamp DESC')
    rows = cursor.fetchall()
    
    # Create CSV string
    output = StringIO()
    writer = csv.writer(output)
    writer.writerow(['Timestamp', 'State', 'Description', 'Tag ID', 'Duration'])
    
    for row in rows:
        writer.writerow([
            row['timestamp'],
            row['state'],
            row['description'],
            row['tag_id'],
            row['duration']
        ])
    
    # Create response with CSV file
    response = StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv"
    )
    response.headers["Content-Disposition"] = "attachment; filename=state_changes.csv"
    
    return response

@app.get("/api/cameras")
async def get_available_cameras():
    """Get list of available cameras."""
    try:
        cameras = detect_available_cameras()
        return {"cameras": [{"id": i, "name": f"Camera {i}"} for i in cameras]}
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"error": str(e)}
        )

@app.post("/api/camera/select/{camera_id}")
async def select_camera(camera_id: int):
    """Select a camera by ID."""
    try:
        if initialize_camera(camera_id):
            return {"status": "success", "camera_info": detector.get_camera_info()}
        return JSONResponse(
            status_code=400,
            content={"error": f"Could not initialize camera {camera_id}"}
        )
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"error": str(e)}
        )

@app.get("/api/camera/info")
async def get_camera_info():
    """Get information about the current camera."""
    try:
        if detector is None:
            return JSONResponse(
                status_code=400,
                content={"error": "No camera initialized"}
            )
        return detector.get_camera_info()
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"error": str(e)}
        )

def get_state_description(state: str) -> str:
    descriptions = {
        'RUNNING': 'Machine operating - Tag movement detected',
        'IDLE': 'Machine idle - Tag stationary',
        'ERROR': 'Error - No tag detected'
    }
    return descriptions.get(state, '')

def process_camera_feed():
    global current_state, last_tag_id, state_start_time
    while True:
        try:
            if detector is None or detector.cap is None or not detector.cap.isOpened():
                time.sleep(1)
                continue
            ret, frame = detector.cap.read()
            if not ret:
                continue
            # Process frame with ArUco detector
            state, tag_id, _ = detector.detect_state(frame)
            # Update state if changed
            if state != current_state:
                print(f"[StateChange] State changed from {current_state} to {state}, tag_id={tag_id}")
                if state_start_time is not None:
                    duration = int((datetime.now() - state_start_time).total_seconds())
                    save_state_change(current_state, duration, get_state_description(current_state), last_tag_id)
                    print(f"[DB] Saved state {current_state} with duration {duration}s")
                current_state = state
                state_start_time = datetime.now()
                last_tag_id = tag_id
                # Broadcast state change to all connected clients
                asyncio.run(manager.broadcast({
                    'state': current_state,
                    'last_tag_id': last_tag_id,
                    'timestamp': datetime.now().isoformat()
                }))
            time.sleep(0.1)  # Small delay to prevent high CPU usage
        except Exception as e:
            print(f"Error processing camera feed: {e}")
            time.sleep(1)

def generate_frames():
    """Generate camera frames for streaming."""
    while True:
        if detector is None or detector.cap is None or not detector.cap.isOpened():
            time.sleep(1)
            continue
        try:
            ret, frame = detector.cap.read()
            if not ret:
                continue
            # Get state, tag_id, and frame with bounding box
            state, tag_id, frame = detector.detect_state(frame)
            # Draw state information on frame
            state_text = f"State: {state}"
            if tag_id is not None:
                state_text += f" (Tag: {tag_id})"
            cv2.putText(frame, state_text, (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 0), 2)
            # Convert frame to JPEG
            ret, buffer = cv2.imencode('.jpg', frame)
            frame = buffer.tobytes()
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + frame + b'\r\n')
        except Exception as e:
            print(f"Error generating frame: {e}")
            time.sleep(1)

@app.get("/camera")
async def camera_view():
    """Serve the camera view page."""
    return FileResponse("static/camera.html")

@app.get("/video_feed")
async def video_feed():
    """Stream the camera feed."""
    return StreamingResponse(generate_frames(),
                            media_type="multipart/x-mixed-replace; boundary=frame")

@app.get("/api/camera/properties")
async def get_camera_properties():
    """Get available camera properties and their current values."""
    if detector is None or detector.cap is None:
        return JSONResponse(
            status_code=400,
            content={"error": "No camera initialized"}
        )
    
    properties = {
        "CAP_PROP_FRAME_WIDTH": int(detector.cap.get(cv2.CAP_PROP_FRAME_WIDTH)),
        "CAP_PROP_FRAME_HEIGHT": int(detector.cap.get(cv2.CAP_PROP_FRAME_HEIGHT)),
        "CAP_PROP_FPS": int(detector.cap.get(cv2.CAP_PROP_FPS)),
        "CAP_PROP_BRIGHTNESS": float(detector.cap.get(cv2.CAP_PROP_BRIGHTNESS)),
        "CAP_PROP_CONTRAST": float(detector.cap.get(cv2.CAP_PROP_CONTRAST)),
        "CAP_PROP_SATURATION": float(detector.cap.get(cv2.CAP_PROP_SATURATION)),
        "CAP_PROP_GAIN": float(detector.cap.get(cv2.CAP_PROP_GAIN)),
        "CAP_PROP_EXPOSURE": float(detector.cap.get(cv2.CAP_PROP_EXPOSURE)),
        "CAP_PROP_AUTO_EXPOSURE": float(detector.cap.get(cv2.CAP_PROP_AUTO_EXPOSURE)),
        "CAP_PROP_AUTOFOCUS": float(detector.cap.get(cv2.CAP_PROP_AUTOFOCUS))
    }
    return properties

@app.post("/api/camera/properties")
async def update_camera_properties(properties: dict):
    """Update camera properties."""
    if detector is None or detector.cap is None:
        return JSONResponse(
            status_code=400,
            content={"error": "No camera initialized"}
        )
    
    try:
        for prop, value in properties.items():
            if hasattr(cv2, prop):
                detector.cap.set(getattr(cv2, prop), value)
        return {"status": "success"}
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"error": str(e)}
        )

@app.get("/api/detector/settings")
async def get_detector_settings():
    """Get current detector settings."""
    if detector is None:
        return JSONResponse(
            status_code=400,
            content={"error": "No detector initialized"}
        )
    
    return {
        "movement_threshold": detector.movement_threshold,
        "error_timeout": detector.error_timeout,
        "state_change_delay": detector.state_change_delay
    }

@app.post("/api/detector/settings")
async def update_detector_settings(settings: dict):
    """Update detector settings."""
    if detector is None:
        return JSONResponse(
            status_code=400,
            content={"error": "No detector initialized"}
        )
    
    try:
        if "movement_threshold" in settings:
            detector.movement_threshold = float(settings["movement_threshold"])
        if "error_timeout" in settings:
            detector.error_timeout = float(settings["error_timeout"])
        if "state_change_delay" in settings:
            detector.state_change_delay = float(settings["state_change_delay"])
        return {"status": "success"}
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"error": str(e)}
        )

if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host='0.0.0.0', port=8000) 