import cv2

def list_cameras():
    """List all available cameras on the system."""
    print("\nChecking available cameras...")
    
    # Try cameras 0 through 9
    available_cameras = []
    for i in range(10):
        cap = cv2.VideoCapture(i, cv2.CAP_DSHOW)  # Use DirectShow on Windows
        if cap.isOpened():
            ret, frame = cap.read()
            if ret:
                print(f"Camera {i} is available")
                available_cameras.append(i)
            cap.release()
        else:
            print(f"Camera {i} is not available")
    
    if available_cameras:
        print(f"\nFound {len(available_cameras)} camera(s): {available_cameras}")
        print("\nUse these indices in the detector scripts.")
    else:
        print("\nNo cameras found!")
        print("Please check if:")
        print("1. Your camera is properly connected")
        print("2. The camera drivers are installed")
        print("3. Other applications aren't using the camera")

if __name__ == "__main__":
    list_cameras() 