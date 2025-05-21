import cv2
import numpy as np
import asyncio
from datetime import datetime
from models import MachineState, SessionLocal, CST
import math
import time
from typing import Optional, List, Tuple

class ArUcoStateDetector:
    def __init__(self, camera_id: Optional[int] = None, movement_threshold=0.5, error_timeout=3.0, state_change_delay=0.5):
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
        self.aruco_dict = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
        self.parameters = cv2.aruco.DetectorParameters()
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
        try:
            self.setup_camera()
        except Exception as e:
            print(f"Warning: Failed to initialize camera: {e}")
            self.cap = None
        
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

    def setup_camera(self):
        """Set up camera with optimal parameters for performance."""
        self.cap = cv2.VideoCapture(self.camera_id, cv2.CAP_DSHOW)
        
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

    def _calculate_movement(self, current_position):
        """Calculate movement distance between current and last position."""
        if self.last_position is None:
            return 0.0
        
        movement = math.sqrt(
            (current_position[0] - self.last_position[0])**2 +
            (current_position[1] - self.last_position[1])**2
        )
        
        # Update movement history
        self.movement_history.append(movement > self.movement_threshold)
        if len(self.movement_history) > self.movement_history_size:
            self.movement_history.pop(0)
        
        return movement

    def _is_consistent_movement(self):
        """Check if movement is consistent across recent frames."""
        if len(self.movement_history) < self.movement_history_size:
            return False
        return sum(self.movement_history) >= self.movement_confidence_threshold

    def _get_description(self, state):
        """Get a random description for the current state."""
        import random
        return random.choice(self.descriptions[state])

    def _update_state(self, new_state, current_time):
        """
        Update state with enhanced state transition logic.
        Returns True if state was changed, False otherwise.
        """
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

    async def process_frame(self):
        """Process a single frame and determine machine state."""
        if not self.cap or not self.cap.isOpened():
            self.setup_camera()
            if not self.cap.isOpened():
                raise RuntimeError(f"Could not open camera {self.camera_id}")

        # Frame rate control
        current_time = time.time()
        elapsed = current_time - self.last_frame_time
        if elapsed < self.frame_time:
            await asyncio.sleep(self.frame_time - elapsed)
        self.last_frame_time = current_time

        try:
            ret, frame = self.cap.read()
            if not ret:
                raise RuntimeError("Failed to capture frame")

            # Detect ArUco markers
            corners, ids, _ = self.detector.detectMarkers(frame)
            
            current_time = datetime.now(CST)  # Use timezone-aware datetime
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

                # Draw detection results for debugging
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

            # Show frame if window exists
            if cv2.getWindowProperty('Machine State Detection', cv2.WND_PROP_VISIBLE) >= 0:
                cv2.imshow('Machine State Detection', frame)
                cv2.waitKey(1)

            # If state changed, add to queue for database processing
            if state_changed:
                new_state_entry = MachineState(
                    state=self.current_state,
                    timestamp=current_time,  # Use timezone-aware timestamp
                    duration=0.0,
                    description=self._get_description(self.current_state)
                )
                await self.state_queue.put((new_state_entry, current_time))
            
            return None

        except Exception as e:
            print(f"Error processing frame: {e}")
            return None

    async def database_worker(self):
        """Separate worker for database operations."""
        db = SessionLocal()
        try:
            while True:
                try:
                    new_state, current_time = await self.state_queue.get()
                    
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
        if not self.cap:
            return {"error": "Camera not initialized"}
        
        return {
            "camera_id": self.camera_id,
            "width": int(self.cap.get(cv2.CAP_PROP_FRAME_WIDTH)),
            "height": int(self.cap.get(cv2.CAP_PROP_FRAME_HEIGHT)),
            "fps": int(self.cap.get(cv2.CAP_PROP_FPS))
        }

    def detect_state(self) -> Tuple[str, Optional[str], Optional[int]]:
        """Detect the current state from the camera feed."""
        if not self.cap:
            if not self.initialize_camera():
                return "ERROR", "Camera not initialized", None

        ret, frame = self.cap.read()
        if not ret:
            return "ERROR", "Failed to read from camera", None

        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        corners, ids, rejected = self.detector.detectMarkers(gray)

        if ids is not None:
            # Get the first detected tag
            tag_id = ids[0][0]
            return "RUNNING", f"Detected tag {tag_id}", tag_id
        else:
            return "IDLE", "No tag detected", None

    def __del__(self):
        """Cleanup when the object is destroyed."""
        if self.cap:
            self.cap.release()

# Create a global instance
detector = ArUcoStateDetector(state_change_delay=0.5) 