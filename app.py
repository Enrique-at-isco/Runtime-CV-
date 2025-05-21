from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
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

app = FastAPI()

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins
    allow_credentials=True,
    allow_methods=["*"],  # Allows all methods
    allow_headers=["*"],  # Allows all headers
)

# Initialize detector
detector = ArUcoStateDetector()

# Equipment name storage
EQUIPMENT_NAME_FILE = "equipment_name.txt"

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

# Print URL on startup
@app.on_event("startup")
async def startup_event():
    ip = get_ip()
    url = f'http://{ip}:8000'
    print("\n" + "="*50)
    print(f"=== Server is running! Access it at: {url} ===")
    print("="*50 + "\n")

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
    return FileResponse("templates/index.html")

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
    else:
        return JSONResponse(status_code=400, content={"error": "Invalid period"})
    
    state_counts = get_state_counts(start_time, now)
    
    return {
        "state_counts": state_counts,
        "period": period,
        "start_time": start_time.isoformat(),
        "end_time": now.isoformat()
    }

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
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
        print("Client disconnected")

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
        cameras = ArUcoStateDetector.get_available_cameras()
        return {"cameras": cameras}
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"error": str(e)}
        )

@app.post("/api/camera/select/{camera_id}")
async def select_camera(camera_id: int):
    """Select a camera by ID."""
    try:
        detector.initialize_camera(camera_id)
        return {"status": "success", "camera_info": detector.get_camera_info()}
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"error": str(e)}
        )

@app.get("/api/camera/info")
async def get_camera_info():
    """Get information about the current camera."""
    try:
        return detector.get_camera_info()
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"error": str(e)}
        ) 