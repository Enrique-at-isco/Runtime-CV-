import cv2

aruco_dict = cv2.aruco.Dictionary_get(cv2.aruco.DICT_4X4_50)
parameters = cv2.aruco.DetectorParameters_create()

cap = cv2.VideoCapture(0)  # Change to '/dev/video0' if needed

while True:
    ret, frame = cap.read()
    if not ret:
        print("Failed to grab frame")
        break
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    corners, ids, rejected = cv2.aruco.detectMarkers(gray, aruco_dict, parameters=parameters)
    if ids is not None:
        print(f"Detected tag(s): {ids.flatten()}")
        frame = cv2.aruco.drawDetectedMarkers(frame, corners, ids)
    else:
        print("No tag detected")
    cv2.imshow("ArUco Detection", frame)
    if cv2.waitKey(1) & 0xFF == ord('q'):
        break

cap.release()
cv2.destroyAllWindows() 