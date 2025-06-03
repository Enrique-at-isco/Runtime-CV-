import cv2
import numpy as np
import asyncio
from datetime import datetime
from models import MachineState, SessionLocal, CST
import math
import time
from typing import Optional, List, Tuple
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class ArUcoStateDetector:
    def __init__(self, camera_id: Optional[str] = None, movement_threshold=0.5, error_timeout=3.0, state_change_delay=0.5):
        """
        Initialize the ArUco state detector.
        
        Args:
            camera_id: Camera device ID (default: None)
            movement_threshold: Minimum movement distance to consider as motion (in pixels)
            error_timeout: Time without tag detection to trigger ERROR state (in seconds)
            state_change_delay: Time required in new state before registering the change (in seconds)
        """
        self.camera_id = camera_id
        self.movement_threshold = movement_threshold
        self.error_timeout = error_timeout
        self.state_change_delay = state_change_delay
        
        # Movement detection enhancement
        self.movement_history = []
        self.movement_history_size = 6  # Number of frames to keep in history
        self.movement_confidence_threshold = 4  # Number of frames that must show movement
        
        # Initialize ArUco detector
        self.aruco_dict = cv2.aruco.Dictionary_get(cv2.aruco.DICT_4X4_50)
        self.parameters = cv2.aruco.DetectorParameters_create()
        
        # Compatibility for OpenCV >= 4.7.0
        self.detector = None
        version = tuple(map(int, cv2.__version__.split(".")[:2]))
        if version >= (4, 7):
            self.detector = cv2.aruco.ArucoDetector(self.aruco_dict, self.parameters)
        
        # State tracking
        self.last_position = None
        self.last_detection_time = None
        self.current_state = 'IDLE'
        self.last_tag_id = None
        
        # State change tracking
        self.pending_state = None
        self.pending_state_start_time = None
        
        # Performance optimization parameters
        self.frame_size = (640, 480)  # Reduced resolution for processing
        self.target_fps = 30
        self.frame_time = 1.0 / self.target_fps
        self.last_frame_time = 0
        
        # Separate queue for database operations
        self.state_queue = asyncio.Queue()
        
        # Camera setup
        self.cap = None
        self.setup_camera()
        
        # State descriptions
        self.descriptions = {
            'RUNNING': ['Machine operating - Tag movement detected',
                       'Production in progress - Active motion',
                       'CNC running - Tag tracking active'],
            'IDLE': ['Machine idle - Tag stationary',
                    'Production paused - No movement detected',
                    'CNC idle - Tag position stable'],
            'ERROR': ['Error - No tag detected',
                     'Machine error - Lost tag tracking',
                     'CNC error - Tag detection failed']
        }

        # In __init__
        self.position_history = []
        self.position_history_size = 5  # Number of frames to average over
        self.last_state_change_time = None
        self.last_movement_time = None
        self.min_running_hold_time = 10  # seconds: must be below threshold this long to switch to IDLE
        self.min_idle_hold_time = 2     # seconds: must be above threshold this long to switch to RUNNING
        self.movement_event_window = 10  # seconds: window to look for recent movement
        self.movement_events = []  # list of (timestamp, movement) for recent significant movements

    def setup_camera(self):
        """Set up camera with optimal parameters for performance."""
        try:
            if self.cap is not None:
                self.cap.release()
            
            # Try different camera backends
            backends = [
                (cv2.CAP_V4L2, "V4L2"),
                (cv2.CAP_DSHOW, "DirectShow"),
                (cv2.CAP_ANY, "Default")
            ]
            
            for backend, name in backends:
                try:
                    logger.info(f"Trying to open camera {self.camera_id} with {name} backend")
                    self.cap = cv2.VideoCapture(self.camera_id, backend)
                    if self.cap.isOpened():
                        logger.info(f"Successfully opened camera with {name} backend")
                        break
                except Exception as e:
                    logger.warning(f"Failed to open camera with {name} backend: {e}")
                    continue
            
            if not self.cap or not self.cap.isOpened():
                raise RuntimeError(f"Failed to open camera {self.camera_id} with any backend")
            
            # Set reduced resolution
            self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, self.frame_size[0])
            self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, self.frame_size[1])
            
            # Set target FPS
            self.cap.set(cv2.CAP_PROP_FPS, self.target_fps)
            
            # Disable auto focus and exposure for faster frame processing
            self.cap.set(cv2.CAP_PROP_AUTOFOCUS, 0)
            self.cap.set(cv2.CAP_PROP_AUTO_EXPOSURE, 0.25)  # 0.25 means manual exposure
            
            # Set buffer size to 1 to minimize latency
            self.cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            
            # Verify camera settings
            actual_width = self.cap.get(cv2.CAP_PROP_FRAME_WIDTH)
            actual_height = self.cap.get(cv2.CAP_PROP_FRAME_HEIGHT)
            actual_fps = self.cap.get(cv2.CAP_PROP_FPS)
            
            logger.info(f"Camera initialized with resolution {actual_width}x{actual_height} at {actual_fps} FPS")
            
        except Exception as e:
            logger.error(f"Error setting up camera: {e}")
            if self.cap is not None:
                self.cap.release()
            self.cap = None
            raise

    def _calculate_movement(self, current_position):
        """Calculate movement distance between current and last position."""
        if self.last_position is None:
            return 0.0
        
        try:
            movement = math.sqrt(
                (current_position[0] - self.last_position[0])**2 +
                (current_position[1] - self.last_position[1])**2
            )
            
            # Update movement history
            self.movement_history.append(movement > self.movement_threshold)
            if len(self.movement_history) > self.movement_history_size:
                self.movement_history.pop(0)
            
            return movement
        except Exception as e:
            logger.error(f"Error calculating movement: {e}")
            return 0.0

    def _is_consistent_movement(self):
        """Check if movement is consistent across recent frames."""
        try:
            if len(self.movement_history) < self.movement_history_size:
                return False
            return sum(self.movement_history) >= self.movement_confidence_threshold
        except Exception as e:
            logger.error(f"Error checking movement consistency: {e}")
            return False

    def _get_description(self, state):
        """Get a random description for the current state."""
        try:
            import random
            return random.choice(self.descriptions[state])
        except Exception as e:
            logger.error(f"Error getting state description: {e}")
            return f"State: {state}"

    def _update_state(self, new_state, current_time):
        """
        Update state with enhanced state transition logic.
        Returns True if state was changed, False otherwise.
        """
        try:
            if new_state == self.current_state:
                self.pending_state = None
                self.pending_state_start_time = None
                return False

            # Special case for ERROR state - apply immediately
            if new_state == 'ERROR':
                self.current_state = new_state
                self.pending_state = None
                self.pending_state_start_time = None
                return True

            # Enhanced state transition logic
            if new_state == 'RUNNING' and self._is_consistent_movement():
                # Transition to RUNNING more quickly when movement is consistent
                self.current_state = new_state
                self.pending_state = None
                self.pending_state_start_time = None
                return True

            # Start or update pending state
            if self.pending_state != new_state:
                self.pending_state = new_state
                self.pending_state_start_time = current_time
                return False

            # Check if enough time has passed in the pending state
            if (current_time - self.pending_state_start_time).total_seconds() >= self.state_change_delay:
                self.current_state = new_state
                self.pending_state = None
                self.pending_state_start_time = None
                return True

            return False
        except Exception as e:
            logger.error(f"Error updating state: {e}")
            return False

    def process_frame(self):
        """Process a single frame and determine machine state."""
        if not self.cap or not self.cap.isOpened():
            self.setup_camera()
            if not self.cap.isOpened():
                raise RuntimeError(f"Could not open camera {self.camera_id}")

        # Frame rate control with adaptive timing
        current_time = time.time()
        elapsed = current_time - self.last_frame_time
        if elapsed < self.frame_time:
            time.sleep(max(0, self.frame_time - elapsed))
        self.last_frame_time = current_time

        try:
            # Skip frames if we're falling behind
            if self.cap.get(cv2.CAP_PROP_POS_FRAMES) % 2 != 0:
                self.cap.grab()
                return None

            ret, frame = self.cap.read()
            if not ret:
                raise RuntimeError("Failed to capture frame")

            # Resize frame for faster processing
            frame = cv2.resize(frame, self.frame_size, interpolation=cv2.INTER_AREA)

            # Convert to grayscale for ArUco detection
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            
            # Detect ArUco markers with optimized parameters
            if self.detector is not None:
                corners, ids, rejected = self.detector.detectMarkers(gray)
            else:
                corners, ids, rejected = cv2.aruco.detectMarkers(gray, self.aruco_dict, parameters=self.parameters)
            
            current_time = datetime.now(CST)
            movement = 0.0
            state_changed = False

            if len(corners) > 0:
                # Use the first detected marker
                marker_corners = corners[0][0]
                marker_center = np.mean(marker_corners, axis=0)
                current_position = (float(marker_center[0]), float(marker_center[1]))
                
                if ids is not None and len(ids) > 0:
                    self.last_tag_id = int(ids[0][0])
                
                # Calculate movement
                movement = self._calculate_movement(current_position)
                
                # Determine new state based on movement
                new_state = 'RUNNING' if movement > self.movement_threshold else 'IDLE'
                state_changed = self._update_state(new_state, current_time)
                
                self.last_position = current_position
                self.last_detection_time = current_time

                # Only draw debug visualization if window is visible
                if cv2.getWindowProperty('Machine State Detection', cv2.WND_PROP_VISIBLE) >= 0:
                    frame = cv2.aruco.drawDetectedMarkers(frame, corners, ids)
                    center = (int(current_position[0]), int(current_position[1]))
                    cv2.circle(frame, center, 5, (0, 255, 0), -1)
                    
                    state_text = f"State: {self.current_state}"
                    if self.pending_state:
                        state_text += f" (Pending: {self.pending_state})"
                    cv2.putText(frame, state_text,
                               (10, 30), cv2.FONT_HERSHEY_SIMPLEX,
                               1, (0, 255, 0), 2)
                    
                    cv2.putText(frame, f"Movement: {movement:.1f}",
                               (10, 60), cv2.FONT_HERSHEY_SIMPLEX,
                               1, (0, 255, 0), 2)
            else:
                if (self.last_detection_time is None or 
                    (current_time - self.last_detection_time).total_seconds() > self.error_timeout):
                    state_changed = self._update_state('ERROR', current_time)
                    self.last_position = None

            # Show frame if window exists and debug mode is enabled
            if cv2.getWindowProperty('Machine State Detection', cv2.WND_PROP_VISIBLE) >= 0:
                cv2.imshow('Machine State Detection', frame)
                cv2.waitKey(1)

            # If state changed, add to queue for database processing
            if state_changed:
                new_state_entry = MachineState(
                    state=self.current_state,
                    timestamp=current_time,
                    duration=0.0,
                    description=self._get_description(self.current_state),
                    tag_id=self.last_tag_id
                )
                asyncio.create_task(self.state_queue.put((new_state_entry, current_time)))
            
            return None

        except Exception as e:
            logger.error(f"Error processing frame: {e}")
            return None

    async def database_worker(self):
        """Separate worker for database operations."""
        db = SessionLocal()
        try:
            while True:
                try:
                    new_state, current_time = await self.state_queue.get()

                    # Prevent zero-duration and duplicate state entries
                    last_state = db.query(MachineState).order_by(MachineState.timestamp.desc()).first()
                    if last_state:
                        # Skip if same state and timestamp (duplicate)
                        if (last_state.state == new_state.state and
                            last_state.timestamp == new_state.timestamp):
                            continue
                        # Skip if new state would have zero duration (same timestamp as last)
                        if last_state.timestamp == new_state.timestamp:
                            continue

                    # Add the new state to the database
                    db.add(new_state)
                    db.commit()

                    # Update durations for all states
                    MachineState.update_durations(db)

                except Exception as e:
                    print(f"Error in database worker: {e}")
                    db.rollback()
                finally:
                    await asyncio.sleep(0.1)  # Prevent CPU overload
        finally:
            db.close()

    async def run(self):
        """Main run loop for the detector."""
        # Start database worker
        db_worker = asyncio.create_task(self.database_worker())
        
        try:
            while True:
                await self.process_frame()
                await asyncio.sleep(0.01)  # Small delay to prevent CPU overload
        except Exception as e:
            print(f"Error in run loop: {e}")
        finally:
            db_worker.cancel()
            if self.cap:
                self.cap.release()
            cv2.destroyAllWindows()

    @staticmethod
    def get_available_cameras() -> List[int]:
        """Returns a list of available camera indices."""
        available_cameras = []
        for i in range(10):  # Check first 10 indices
            cap = cv2.VideoCapture(i)
            if cap.isOpened():
                available_cameras.append(i)
                cap.release()
        return available_cameras

    def initialize_camera(self, camera_id: Optional[int] = None) -> bool:
        """Initialize camera with given ID or auto-select if None."""
        if camera_id is not None:
            self.camera_id = camera_id
        
        if self.camera_id is None:
            available_cameras = self.get_available_cameras()
            if not available_cameras:
                raise RuntimeError("No cameras found!")
            elif len(available_cameras) == 1:
                self.camera_id = available_cameras[0]
            else:
                raise RuntimeError("Multiple cameras found. Please select one.")
        
        self.cap = cv2.VideoCapture(self.camera_id)
        if not self.cap.isOpened():
            raise RuntimeError(f"Failed to open camera {self.camera_id}")
        return True

    def get_camera_info(self) -> dict:
        """Get information about the current camera."""
        try:
            if self.cap is None or not self.cap.isOpened():
                return {"error": "Camera not initialized"}
            
            return {
                "width": self.cap.get(cv2.CAP_PROP_FRAME_WIDTH),
                "height": self.cap.get(cv2.CAP_PROP_FRAME_HEIGHT),
                "fps": self.cap.get(cv2.CAP_PROP_FPS),
                "brightness": self.cap.get(cv2.CAP_PROP_BRIGHTNESS),
                "contrast": self.cap.get(cv2.CAP_PROP_CONTRAST),
                "saturation": self.cap.get(cv2.CAP_PROP_SATURATION),
                "gain": self.cap.get(cv2.CAP_PROP_GAIN),
                "exposure": self.cap.get(cv2.CAP_PROP_EXPOSURE),
                "auto_exposure": self.cap.get(cv2.CAP_PROP_AUTO_EXPOSURE),
                "auto_focus": self.cap.get(cv2.CAP_PROP_AUTOFOCUS)
            }
        except Exception as e:
            logger.error(f"Error getting camera info: {e}")
            return {"error": str(e)}

    def detect_state(self, frame):
        """
        Detect ArUco markers and determine machine state from a single frame.
        Returns (state, tag_id, frame_with_markers)
        """
        try:
            if frame is None:
                return 'ERROR', None, None

            # Detect ArUco markers
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            if self.detector is not None:
                corners, ids, rejected = self.detector.detectMarkers(gray)
            else:
                corners, ids, rejected = cv2.aruco.detectMarkers(gray, self.aruco_dict, parameters=self.parameters)
            
            current_time = datetime.now(CST)
            avg_movement = 0.0
            tag_id = None
            state_changed = False
            now_ts = time.time()

            if len(corners) > 0:
                # Use the first detected marker
                marker_corners = corners[0][0]
                marker_center = np.mean(marker_corners, axis=0)
                current_position = (float(marker_center[0]), float(marker_center[1]))
                
                if ids is not None and len(ids) > 0:
                    tag_id = int(ids[0][0])
                    self.last_tag_id = tag_id
                
                # Add current position to history
                self.position_history.append(current_position)
                if len(self.position_history) > self.position_history_size:
                    self.position_history.pop(0)

                # Calculate average movement over the buffer
                if len(self.position_history) > 1:
                    movements = [
                        math.sqrt(
                            (self.position_history[i][0] - self.position_history[i-1][0])**2 +
                            (self.position_history[i][1] - self.position_history[i-1][1])**2
                        )
                        for i in range(1, len(self.position_history))
                    ]
                    avg_movement = sum(movements) / len(movements)
                else:
                    avg_movement = 0.0

                # --- Recent movement window logic ---
                # Record significant movement events
                if avg_movement > self.movement_threshold:
                    self.movement_events.append((now_ts, avg_movement))
                # Remove old events outside the window
                self.movement_events = [evt for evt in self.movement_events if now_ts - evt[0] <= self.movement_event_window]

                # State logic: RUNNING if any significant movement in window, else IDLE
                if len(self.movement_events) > 0:
                    if self.current_state != 'RUNNING':
                        state_changed = self._update_state('RUNNING', current_time)
                else:
                    if self.current_state != 'IDLE':
                        state_changed = self._update_state('IDLE', current_time)

                self.last_position = current_position
                self.last_detection_time = current_time

                # Draw detection results
                frame = cv2.aruco.drawDetectedMarkers(frame, corners, ids)
                center = (int(current_position[0]), int(current_position[1]))
                cv2.circle(frame, center, 5, (0, 255, 0), -1)
                
                # Overlay: show state and pending state clearly
                state_text = f"State: {self.current_state}"
                if self.pending_state and self.pending_state != self.current_state:
                    state_text += f" (pending {self.pending_state})"
                cv2.putText(frame, state_text,
                           (10, 30), cv2.FONT_HERSHEY_SIMPLEX,
                           1, (0, 255, 0), 2)
                cv2.putText(frame, f"Avg Movement: {avg_movement:.2f}",
                           (10, 60), cv2.FONT_HERSHEY_SIMPLEX,
                           1, (0, 255, 0), 2)
            else:
                if (self.last_detection_time is None or 
                    (current_time - self.last_detection_time).total_seconds() > self.error_timeout):
                    state_changed = self._update_state('ERROR', current_time)
                    self.last_position = None
                    self.position_history = []
                    self.movement_events = []

            return self.current_state, tag_id, frame

        except Exception as e:
            logger.error(f"Error detecting state: {e}")
            return 'ERROR', None, frame

    def __del__(self):
        """Cleanup when the detector is destroyed."""
        try:
            if self.cap is not None:
                self.cap.release()
        except Exception as e:
            logger.error(f"Error during cleanup: {e}")

# Create a global instance
detector = None  # Initialize as None

def initialize_detector(camera_id: Optional[str] = "0"):
    """Initialize the detector with a specific camera ID"""
    global detector
    try:
        detector = ArUcoStateDetector(camera_id=camera_id, state_change_delay=0.5)
        return True
    except Exception as e:
        logger.error(f"Failed to initialize detector: {e}")
        return False

# Initialize with default camera (0)
initialize_detector() 