import cv2
from pupil_apriltags import Detector
import time

def test_camera():
    print("Initializing camera...")
    cap = cv2.VideoCapture(0)
    
    if not cap.isOpened():
        print("Error: Could not open camera")
        return
    
    print("Camera opened successfully!")
    print("Initializing AprilTag detector...")
    
    detector = Detector(
        families='tag36h11',
        nthreads=1,
        quad_decimate=2.0,
        quad_sigma=0.0,
        refine_edges=1,
        decode_sharpening=0.25,
        debug=0
    )
    
    print("Starting camera test - Press 'q' to quit")
    print("Looking for AprilTags...")
    
    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                print("Error: Couldn't read frame")
                break
                
            # Convert to grayscale
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            
            # Detect AprilTags
            results = detector.detect(gray)
            
            # Draw detection results
            for r in results:
                # Draw center point
                center = (int(r.center[0]), int(r.center[1]))
                cv2.circle(frame, center, 5, (0, 255, 0), -1)
                
                # Draw tag ID
                cv2.putText(frame, f"Tag {r.tag_id}", 
                           (center[0] - 10, center[1] - 10),
                           cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 2)
                
                # Draw bounding box
                pts = r.corners.astype(int)
                cv2.polylines(frame, [pts.reshape((-1, 1, 2))], True, (0, 255, 0), 2)
            
            # Show frame
            cv2.imshow('Camera Test', frame)
            
            # Print detection results
            if results:
                print(f"Detected {len(results)} tags: {[r.tag_id for r in results]}")
            
            # Check for quit
            if cv2.waitKey(1) & 0xFF == ord('q'):
                break
                
    finally:
        cap.release()
        cv2.destroyAllWindows()
        print("Camera test completed")

if __name__ == "__main__":
    test_camera() 