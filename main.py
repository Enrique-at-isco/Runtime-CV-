import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, Depends
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, FileResponse, StreamingResponse
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
from typing import List
import json
import webbrowser
import threading
import time
import pytz
import cv2
import io
import csv

from models import get_db, MachineState, init_db, calculate_hourly_metrics, CST, Base
from apriltag_detector import detector

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    detector_task = asyncio.create_task(detector.run())
    broadcast_task = asyncio.create_task(broadcast_state_updates())
    yield
    # Shutdown
    detector_task.cancel()
    broadcast_task.cancel()
    if detector.cap:
        detector.cap.release()
    cv2.destroyAllWindows()

app = FastAPI(lifespan=lifespan)

# Mount static files
app.mount("/static", StaticFiles(directory="static"), name="static")

# Store WebSocket connections
active_connections: List[WebSocket] = []

@app.get("/")
async def get_index():
    return FileResponse("static/index.html")

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            # Only send updates during working hours
            now = datetime.now(CST)
            if MachineState.is_working_hours(now):
                # Add rate limiting to WebSocket updates
                await websocket.send_json({
                    "state": detector.current_state,
                    "last_tag_id": detector.last_tag_id
                })
                await asyncio.sleep(0.1)  # Limit to 10 updates per second
            else:
                await websocket.send_json({
                    "state": "OFFLINE",
                    "last_tag_id": None
                })
                await asyncio.sleep(1.0)  # Slower updates when offline
    except Exception as e:
        print(f"WebSocket error: {e}")
    finally:
        try:
            await websocket.close()
        except:
            pass

@app.get("/api/metrics/{period}")
def get_metrics(period: str, db: Session = Depends(get_db)):
    now = datetime.now(CST)
    
    # Calculate start time based on period
    if period == "today":
        start_time = now.replace(hour=0, minute=0, second=0, microsecond=0)
    elif period == "week":
        # Start from Monday of current week
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
        return {"error": "Invalid period"}
    
    # Get states for the period
    states = db.query(MachineState).filter(
        MachineState.timestamp >= start_time,
        MachineState.timestamp <= now
    ).order_by(MachineState.timestamp.asc()).all()
    
    # Update durations for all states
    MachineState.update_durations(db)
    
    # Calculate durations for each state
    running_duration = sum(state.duration for state in states if state.state == 'RUNNING')
    idle_duration = sum(state.duration for state in states if state.state == 'IDLE')
    error_duration = sum(state.duration for state in states if state.state == 'ERROR')
    
    # Calculate total duration and percentages
    total_duration = running_duration + idle_duration + error_duration
    
    # Calculate hourly metrics for today
    hourly_metrics = None
    if period == "today":
        hourly_metrics = calculate_hourly_metrics(db, now)
    
    # Calculate daily metrics for longer periods
    daily_data = None
    if period in ["week", "month", "quarter", "year"]:
        daily_data = calculate_daily_metrics(db, start_time, now)
        daily_metrics = daily_data['metrics']
        summary = daily_data['summary']
    else:
        summary = {
            'best_day': now.strftime('%Y-%m-%d'),
            'best_day_efficiency': round((running_duration / 28800 * 100) if running_duration > 0 else 0, 1),
            'avg_daily_runtime': running_duration,
            'avg_daily_idle': idle_duration,
            'avg_daily_error': error_duration,
            'weekly_efficiency': round((running_duration / 28800 * 100) if running_duration > 0 else 0, 1),
            'work_days_elapsed': 1
        }
    
    return {
        "state_counts": {
            "RUNNING": running_duration,
            "IDLE": idle_duration,
            "ERROR": error_duration
        },
        "percentages": {
            "RUNNING": round((running_duration / total_duration * 100) if total_duration > 0 else 0, 1),
            "IDLE": round((idle_duration / total_duration * 100) if total_duration > 0 else 0, 1),
            "ERROR": round((error_duration / total_duration * 100) if total_duration > 0 else 0, 1)
        },
        "hourly_metrics": hourly_metrics,
        "daily_metrics": daily_metrics if period in ["week", "month", "quarter", "year"] else None,
        "summary": summary,
        "period": period,
        "start_time": start_time.isoformat(),
        "end_time": now.isoformat()
    }

@app.get("/api/events/{period}")
def get_events(period: str, state: str = "all", limit: int = 50, db: Session = Depends(get_db)):
    now = datetime.now(CST)
    
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
        return {"error": "Invalid period"}
    
    # Update all state durations before returning events
    MachineState.update_durations(db)
    
    # Build query
    query = db.query(MachineState).filter(
        MachineState.timestamp >= start_time,
        MachineState.timestamp <= now
    )
    
    # Apply state filter if specified
    if state != "all":
        query = query.filter(MachineState.state == state.upper())
    
    # Get the events with updated durations
    events = query.order_by(MachineState.timestamp.desc()).limit(limit).all()
    
    return [{
        'id': event.id,
        'timestamp': event.timestamp.isoformat(),
        'state': event.state,
        'duration': event.duration,
        'description': event.description
    } for event in events]

@app.post("/api/clear_data")
def clear_all_data(db: Session = Depends(get_db)):
    """Clear all stored state data from the database."""
    try:
        # Delete all records from MachineState table
        db.query(MachineState).delete()
        db.commit()
        
        # Reset detector state
        detector.last_position = None
        detector.last_detection_time = None
        detector.current_state = 'IDLE'
        detector.pending_state = None
        detector.pending_state_start_time = None
        detector.movement_history = []
        
        return {"status": "success", "message": "All state data cleared successfully"}
    except Exception as e:
        db.rollback()
        return {"status": "error", "message": str(e)}

async def broadcast_state_updates():
    while True:
        if active_connections:
            db = next(get_db())
            current_state = db.query(MachineState).order_by(MachineState.timestamp.desc()).first()
            if current_state:
                for connection in active_connections:
                    try:
                        await connection.send_json({
                            "state": current_state.state,
                            "description": current_state.description,
                            "timestamp": current_state.timestamp.isoformat()
                        })
                    except Exception as e:
                        print(f"WebSocket error: {e}")
                        active_connections.remove(connection)
        await asyncio.sleep(1)

def open_browser():
    """Open the dashboard in the default web browser after a short delay"""
    time.sleep(2)  # Wait for the server to start
    webbrowser.open('http://localhost:8080')

@app.on_event("startup")
async def startup_event():
    # Initialize database
    init_db()
    # Start the detector
    asyncio.create_task(detector.run())

@app.get("/api/export_states")
def export_states(db: Session = Depends(get_db)):
    """Export all state changes as a CSV file."""
    try:
        # Get all state changes ordered by timestamp
        states = db.query(MachineState).order_by(MachineState.timestamp.asc()).all()
        
        # Create CSV in memory
        output = io.StringIO()
        writer = csv.writer(output)
        
        # Write header
        writer.writerow(['State', 'Duration (seconds)', 'Start Time', 'End Time', 'Description'])
        
        # Write data
        for state in states:
            # Calculate end time
            end_time = state.timestamp + timedelta(seconds=state.duration)
            
            writer.writerow([
                state.state,
                f"{state.duration:.1f}",
                state.timestamp.strftime('%Y-%m-%d %H:%M:%S'),
                end_time.strftime('%Y-%m-%d %H:%M:%S'),
                state.description
            ])
        
        # Prepare the output
        output.seek(0)
        
        # Generate filename with current timestamp
        filename = f"state_changes_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
        
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )
        
    except Exception as e:
        print(f"Error exporting states: {e}")
        raise

def calculate_daily_metrics(db, start_time, end_time):
    """Calculate metrics for each day in the given period"""
    daily_metrics = {}
    current_date = start_time
    
    # Track best day and accumulated metrics
    best_day = None
    best_day_efficiency = 0
    total_runtime = 0
    total_idle = 0
    total_error = 0
    work_days_elapsed = 0
    
    while current_date <= end_time:
        next_date = current_date + timedelta(days=1)
        
        # Only consider weekdays (Monday-Friday)
        if current_date.weekday() < 5:
            work_days_elapsed += 1
            
            # Get states for this day
            states = db.query(MachineState).filter(
                MachineState.timestamp >= current_date,
                MachineState.timestamp < next_date
            ).all()
            
            # Calculate metrics for the day
            if states:
                # Update durations before calculating metrics
                for state in states:
                    state.duration = MachineState.calculate_state_duration(db, state)
                
                running_duration = sum(state.duration for state in states if state.state == 'RUNNING')
                idle_duration = sum(state.duration for state in states if state.state == 'IDLE')
                error_duration = sum(state.duration for state in states if state.state == 'ERROR')
                
                # Calculate total work hours for the day (8 hours = 28800 seconds)
                total_work_seconds = 28800
                
                # If no data exists for a day, consider it as 100% error time
                if not states:
                    error_duration = total_work_seconds
                    running_duration = 0
                    idle_duration = 0
                
                # Calculate efficiency for the day
                efficiency = (running_duration / total_work_seconds) * 100
                
                # Track best day
                if efficiency > best_day_efficiency:
                    best_day_efficiency = efficiency
                    best_day = current_date.strftime('%Y-%m-%d')
                
                # Accumulate totals
                total_runtime += running_duration
                total_idle += idle_duration
                total_error += error_duration
                
                daily_metrics[current_date.strftime('%Y-%m-%d')] = {
                    'total_duration': total_work_seconds,
                    'running_duration': running_duration,
                    'idle_duration': idle_duration,
                    'error_duration': error_duration,
                    'efficiency': efficiency,
                    'state_counts': {
                        'RUNNING': len([s for s in states if s.state == 'RUNNING']),
                        'IDLE': len([s for s in states if s.state == 'IDLE']),
                        'ERROR': len([s for s in states if s.state == 'ERROR'])
                    }
                }
            else:
                # No data for this day - consider it as 100% error time
                total_error += 28800  # 8 hours in seconds
                daily_metrics[current_date.strftime('%Y-%m-%d')] = {
                    'total_duration': 28800,
                    'running_duration': 0,
                    'idle_duration': 0,
                    'error_duration': 28800,
                    'efficiency': 0,
                    'state_counts': {
                        'RUNNING': 0,
                        'IDLE': 0,
                        'ERROR': 1
                    }
                }
        
        current_date = next_date
    
    # Calculate weekly metrics
    total_work_seconds = work_days_elapsed * 28800  # 8 hours per workday
    weekly_efficiency = (total_runtime / total_work_seconds * 100) if total_work_seconds > 0 else 0
    
    return {
        'metrics': daily_metrics,
        'summary': {
            'best_day': best_day,
            'best_day_efficiency': round(best_day_efficiency, 1),
            'avg_daily_runtime': total_runtime / work_days_elapsed if work_days_elapsed > 0 else 0,
            'avg_daily_idle': total_idle / work_days_elapsed if work_days_elapsed > 0 else 0,
            'avg_daily_error': total_error / work_days_elapsed if work_days_elapsed > 0 else 0,
            'weekly_efficiency': round(weekly_efficiency, 1),
            'work_days_elapsed': work_days_elapsed
        }
    }

@app.get("/api/events/date/{date}")
def get_events_by_date(date: str, state: str = "all", limit: int = 1000, db: Session = Depends(get_db)):
    try:
        # Parse the date string (expected format: YYYY-MM-DD)
        target_date = datetime.strptime(date, "%Y-%m-%d").replace(tzinfo=CST)
        start_time = target_date.replace(hour=0, minute=0, second=0, microsecond=0)
        end_time = target_date.replace(hour=23, minute=59, second=59, microsecond=999999)
        
        # Update all state durations before returning events
        MachineState.update_durations(db)
        
        # Build query
        query = db.query(MachineState).filter(
            MachineState.timestamp >= start_time,
            MachineState.timestamp <= end_time
        )
        
        # Apply state filter if specified
        if state != "all":
            query = query.filter(MachineState.state == state.upper())
        
        # Get the events with updated durations
        events = query.order_by(MachineState.timestamp.asc()).limit(limit).all()
        
        return [{
            'id': event.id,
            'timestamp': event.timestamp.isoformat(),
            'state': event.state,
            'duration': event.duration,
            'description': event.description
        } for event in events]
    except ValueError:
        return {"error": "Invalid date format. Use YYYY-MM-DD"}
    except Exception as e:
        return {"error": str(e)}

if __name__ == "__main__":
    print("Starting CNC Runtime Dashboard...")
    print("Opening dashboard in your default web browser...")
    
    # Start the browser opener in a separate thread
    threading.Thread(target=open_browser, daemon=True).start()
    
    # Start the application
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080) 