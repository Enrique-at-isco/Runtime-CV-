// Initialize settings
async function initializeSettings() {
    const settingsBtn = document.getElementById('settingsBtn');
    const settingsModal = document.getElementById('settingsModal');
    const closeModal = document.querySelector('.close-modal');
    
    if (!settingsBtn || !settingsModal || !closeModal) {
        console.error('Settings elements not found');
        return;
    }
    
    // Load saved settings
    const savedEquipmentName = localStorage.getItem('equipmentName');
    const savedCamera = localStorage.getItem('selectedCamera');
    const savedRefreshInterval = localStorage.getItem('refreshInterval');
    const savedTimeFormat = localStorage.getItem('timeFormat');
    
    if (savedEquipmentName) {
        document.getElementById('equipmentName').value = savedEquipmentName;
    }
    if (savedCamera) {
        document.getElementById('cameraSelect').value = savedCamera;
    }
    if (savedRefreshInterval) {
        document.getElementById('refreshInterval').value = savedRefreshInterval;
    }
    if (savedTimeFormat) {
        document.getElementById('timeFormat').value = savedTimeFormat;
    }
    
    // Load available cameras
    try {
        const response = await fetch('/api/cameras');
        const data = await response.json();
        const cameraSelect = document.getElementById('cameraSelect');
        cameraSelect.innerHTML = ''; // Clear loading message
        
        if (data.cameras && data.cameras.length > 0) {
            data.cameras.forEach(camera => {
                const option = document.createElement('option');
                option.value = camera.id;
                option.textContent = camera.name;
                cameraSelect.appendChild(option);
            });
            
            // Set saved camera if available
            if (savedCamera) {
                cameraSelect.value = savedCamera;
            }
        } else {
            cameraSelect.innerHTML = '<option value="">No cameras found</option>';
        }
    } catch (error) {
        console.error('Error loading cameras:', error);
        document.getElementById('cameraSelect').innerHTML = '<option value="">Error loading cameras</option>';
    }
    
    // Add event listeners
    settingsBtn.addEventListener('click', () => {
        settingsModal.classList.add('show');
    });
    
    closeModal.addEventListener('click', () => {
        settingsModal.classList.remove('show');
    });
    
    // Close modal when clicking outside
    window.addEventListener('click', (e) => {
        if (e.target === settingsModal) {
            settingsModal.classList.remove('show');
        }
    });
    
    // Dark mode toggle - apply theme immediately
    const themeToggle = document.getElementById('themeToggle');
    if (themeToggle) {
        themeToggle.addEventListener('change', () => {
            if (themeToggle.checked) {
                document.body.classList.add('dark-mode');
                localStorage.setItem('theme', 'dark');
            } else {
                document.body.classList.remove('dark-mode');
                localStorage.setItem('theme', 'light');
            }
        });
    }
    
    // Save equipment name
    document.getElementById('saveEquipmentName').addEventListener('click', async () => {
        const equipmentName = document.getElementById('equipmentName').value;
        try {
            const response = await fetch('/api/equipment/name', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ name: equipmentName })
            });
            const data = await response.json();
            
            if (data.status === 'success') {
                localStorage.setItem('equipmentName', equipmentName);
                // Update dashboard title immediately
                const titleElem = document.querySelector('.header-left h1');
                if (titleElem) {
                    titleElem.textContent = `CNC Runtime Dashboard: ${equipmentName}`;
                }
                alert('Equipment name saved');
            } else {
                alert('Error saving equipment name: ' + data.error);
            }
        } catch (error) {
            console.error('Error saving equipment name:', error);
            alert('Error saving equipment name. Please try again.');
        }
    });
    
    // Save camera selection
    document.getElementById('saveCamera').addEventListener('click', async () => {
        const selectedCamera = document.getElementById('cameraSelect').value;
        try {
            const response = await fetch(`/api/camera/select/${selectedCamera}`, {
                method: 'POST'
            });
            const data = await response.json();
            
            if (data.status === 'success') {
                localStorage.setItem('selectedCamera', selectedCamera);
                alert('Camera selection saved');
                
                // Update camera info display
                const cameraInfo = document.getElementById('cameraInfo');
                cameraInfo.innerHTML = `
                    <p>Camera ID: ${data.camera_info.camera_id}</p>
                    <p>Resolution: ${data.camera_info.width}x${data.camera_info.height}</p>
                    <p>FPS: ${data.camera_info.fps}</p>
                `;
            } else {
                alert('Error saving camera selection: ' + data.error);
            }
        } catch (error) {
            console.error('Error saving camera selection:', error);
            alert('Error saving camera selection. Please try again.');
        }
    });
    
    // Save refresh interval
    document.getElementById('saveRefreshInterval').addEventListener('click', () => {
        const refreshInterval = document.getElementById('refreshInterval').value;
        localStorage.setItem('refreshInterval', refreshInterval);
        alert('Refresh interval saved');
    });
    
    // Save time format
    document.getElementById('saveTimeFormat').addEventListener('click', () => {
        const timeFormat = document.getElementById('timeFormat').value;
        localStorage.setItem('timeFormat', timeFormat);
        alert('Time format saved');
    });
    
    // Initialize theme
    initializeTheme();
} 