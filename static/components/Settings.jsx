import React, { useState, useEffect } from 'react';

const Settings = () => {
    const [cameras, setCameras] = useState([]);
    const [selectedCamera, setSelectedCamera] = useState(null);
    const [cameraInfo, setCameraInfo] = useState(null);
    const [error, setError] = useState(null);
    const [equipmentName, setEquipmentName] = useState('');
    const [isEditingName, setIsEditingName] = useState(false);
    const [nameError, setNameError] = useState(null);

    useEffect(() => {
        loadCameras();
        loadCurrentCamera();
        loadEquipmentName();
    }, []);

    const loadEquipmentName = async () => {
        try {
            const response = await fetch('/api/equipment/name');
            const data = await response.json();
            setEquipmentName(data.name);
        } catch (err) {
            setNameError('Failed to load equipment name');
        }
    };

    const handleNameChange = async (event) => {
        event.preventDefault();
        try {
            const response = await fetch('/api/equipment/name', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ name: equipmentName }),
            });
            const data = await response.json();
            if (data.status === 'success') {
                setIsEditingName(false);
                setNameError(null);
                // Update the page title
                document.title = `Runtime Dashboard: ${data.name}`;
            } else {
                setNameError(data.error || 'Failed to update equipment name');
            }
        } catch (err) {
            setNameError('Failed to update equipment name');
        }
    };

    const loadCameras = async () => {
        try {
            const response = await fetch('/api/cameras');
            const data = await response.json();
            if (data.cameras) {
                setCameras(data.cameras);
            }
        } catch (err) {
            setError('Failed to load cameras');
        }
    };

    const loadCurrentCamera = async () => {
        try {
            const response = await fetch('/api/camera/info');
            const data = await response.json();
            if (!data.error) {
                setCameraInfo(data);
                setSelectedCamera(data.camera_id);
            }
        } catch (err) {
            setError('Failed to load current camera info');
        }
    };

    const handleCameraChange = async (event) => {
        const cameraId = parseInt(event.target.value);
        try {
            const response = await fetch(`/api/camera/select/${cameraId}`, {
                method: 'POST'
            });
            const data = await response.json();
            if (data.status === 'success') {
                setCameraInfo(data.camera_info);
                setSelectedCamera(cameraId);
                setError(null);
            } else {
                setError('Failed to switch camera');
            }
        } catch (err) {
            setError('Failed to switch camera');
        }
    };

    return (
        <div className="p-4">
            <h2 className="text-2xl font-bold mb-4">Settings</h2>
            
            {/* Equipment Name Section */}
            <div className="mb-8">
                <h3 className="text-xl font-semibold mb-2">Equipment Name</h3>
                {nameError && (
                    <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
                        {nameError}
                    </div>
                )}
                <form onSubmit={handleNameChange} className="flex items-center gap-4">
                    <input
                        type="text"
                        value={equipmentName}
                        onChange={(e) => setEquipmentName(e.target.value)}
                        onFocus={() => setIsEditingName(true)}
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                        placeholder="Enter equipment name"
                    />
                    {isEditingName && (
                        <button
                            type="submit"
                            className="px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700"
                        >
                            Save
                        </button>
                    )}
                </form>
            </div>

            {/* Camera Selection Section */}
            <div className="mb-6">
                <h3 className="text-xl font-semibold mb-2">Camera Selection</h3>
                {error && (
                    <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
                        {error}
                    </div>
                )}
                
                <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                        Select Camera
                    </label>
                    <select
                        value={selectedCamera || ''}
                        onChange={handleCameraChange}
                        className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm rounded-md"
                    >
                        <option value="">Select a camera</option>
                        {cameras.map((cameraId) => (
                            <option key={cameraId} value={cameraId}>
                                Camera {cameraId}
                            </option>
                        ))}
                    </select>
                </div>

                {cameraInfo && (
                    <div className="bg-gray-50 p-4 rounded-md">
                        <h4 className="font-medium mb-2">Current Camera Info</h4>
                        <div className="grid grid-cols-2 gap-2 text-sm">
                            <div>Resolution:</div>
                            <div>{cameraInfo.width} x {cameraInfo.height}</div>
                            <div>FPS:</div>
                            <div>{cameraInfo.fps}</div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Settings; 