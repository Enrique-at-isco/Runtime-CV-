import cv2
import numpy as np

def test_camera():
    print("Initializing camera...")
    cap = cv2.VideoCapture(1, cv2.CAP_DSHOW)  # Use DirectShow on Windows
    
    if not cap.isOpened():
        print("Error: Could not open camera")
        return
    
    print("Camera opened successfully!")
    print("Initializing ArUco detector...")
    
    # Initialize ArUco detector
    aruco_dict = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
    aruco_params = cv2.aruco.DetectorParameters()
    detector = cv2.aruco.ArucoDetector(aruco_dict, aruco_params)
    
    print("Starting camera test - Press 'q' to quit")
    print("Looking for ArUco markers...")
    
    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                print("Error: Couldn't read frame")
                break
            
            # Detect ArUco markers
            corners, ids, rejected = detector.detectMarkers(frame)
            
            # Draw detection results
            if len(corners) > 0:
                # Draw markers
                frame = cv2.aruco.drawDetectedMarkers(frame, corners, ids)
                
                # Calculate and draw center points
                for i in range(len(corners)):
                    marker_corners = corners[i][0]
                    center = np.mean(marker_corners, axis=0)
                    center = tuple(map(int, center))
                    
                    # Draw center point
                    cv2.circle(frame, center, 5, (0, 255, 0), -1)
                    
                    # Draw marker ID
                    cv2.putText(frame, f"ID: {ids[i][0]}", 
                               (center[0] - 10, center[1] - 10),
                               cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 2)
                
                print(f"Detected {len(corners)} markers: {[id[0] for id in ids]}")
            
            # Show frame
            cv2.imshow('ArUco Test', frame)
            
            # Check for quit
            if cv2.waitKey(1) & 0xFF == ord('q'):
                break
                
    finally:
        cap.release()
        cv2.destroyAllWindows()
        print("Camera test completed")

if __name__ == "__main__":
    test_camera() 