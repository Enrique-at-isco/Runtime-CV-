// WebSocket connection
let ws = null;
let currentState = 'IDLE';
let lastTagId = null;
let metricsChart = null;
let hourlyChart = null;
let trendChart = null;
let currentPeriod = 'today';
let updateTimer = null;
let stateStartTime = null;
let timeUpdateTimer = null;
let timelineUpdateTimer = null;  // New timer for timeline updates
let wsReconnectAttempts = 0;
let stateDurations = {
    RUNNING: 0,
    IDLE: 0,
    ERROR: 0
};
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY = 5000; // 5 seconds
const TIMELINE_UPDATE_INTERVAL = 10000; // 10 seconds - frequent enough for visual updates but not too heavy
const METRICS_UPDATE_INTERVAL = 60000; // 60 seconds - less frequent for heavier operations

// Initialize all charts
function initializeCharts() {
    initializeMetricsChart();
    initializeHourlyChart();
    initializeTrendChart();
    initializeChronograph();
    startIncrementalUpdates();
    startTimeUpdates();
    startTimelineUpdates();  // New function call
    
    // Restore state start time from localStorage if it exists
    const savedState = localStorage.getItem('currentState');
    const savedStartTime = localStorage.getItem('stateStartTime');
    if (savedState === currentState && savedStartTime) {
        stateStartTime = new Date(parseInt(savedStartTime));
        updateTimeDisplays(); // Update display immediately
    } else {
        // If state doesn't match or no saved time, initialize with current time
        stateStartTime = new Date();
        saveStateInfo(currentState, stateStartTime);
    }

    // Initial fetch of data
    fetchTimelineData();
    updateStateChangeLog(currentPeriod);
    updateMetrics(currentPeriod);
}

// Save state information to localStorage
function saveStateInfo(state, startTime) {
    localStorage.setItem('currentState', state);
    localStorage.setItem('stateStartTime', startTime.getTime().toString());
}

// Start incremental updates
function startIncrementalUpdates() {
    // Clear any existing timer
    if (updateTimer) {
        clearInterval(updateTimer);
    }
    
    // Initial update
    updateMetrics(currentPeriod);
    updateStateChangeLog(currentPeriod);
    
    // Update metrics and state change log every minute
    updateTimer = setInterval(() => {
        updateMetrics(currentPeriod);
        updateStateChangeLog(currentPeriod);
    }, METRICS_UPDATE_INTERVAL);
}

// Start time updates
function startTimeUpdates() {
    // Clear any existing timer
    if (timeUpdateTimer) {
        clearInterval(timeUpdateTimer);
    }
    
    // Update current time and state duration every second
    timeUpdateTimer = setInterval(updateTimeDisplays, 1000);
}

// Start timeline updates
function startTimelineUpdates() {
    // Clear any existing timer
    if (timelineUpdateTimer) {
        clearInterval(timelineUpdateTimer);
    }
    
    // Update timeline every 10 seconds
    timelineUpdateTimer = setInterval(fetchTimelineData, TIMELINE_UPDATE_INTERVAL);
}

// Update time displays and state durations
function updateTimeDisplays() {
    const now = new Date();
    
    // Update current time
    document.getElementById('current-time').textContent = now.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
    });
    
    if (stateStartTime && currentState in stateDurations) {
        const timeInCurrentStateSeconds = (now - stateStartTime) / 1000;
        
        // Update "Time in State" display
        document.getElementById('state-duration').textContent = formatDuration(timeInCurrentStateSeconds);
        
        // Dynamically calculate and display runtime for the CURRENT state
        const currentDynamicTotalDuration = (stateDurations[currentState] || 0) + timeInCurrentStateSeconds;
        document.getElementById(`${currentState.toLowerCase()}Time`).textContent = formatDuration(currentDynamicTotalDuration);
        
        // Update pie chart data dynamically
        const pieChartValues = {
            RUNNING: stateDurations.RUNNING || 0,
            IDLE: stateDurations.IDLE || 0,
            ERROR: stateDurations.ERROR || 0,
        };
        pieChartValues[currentState] = currentDynamicTotalDuration; // Use dynamic value for current state

        if (metricsChart) {
            metricsChart.data.datasets[0].data = [
                pieChartValues.RUNNING,
                pieChartValues.IDLE,
                pieChartValues.ERROR
            ];
            metricsChart.update('none');
        }
        
        // Update main efficiency display dynamically
        const totalPieTime = pieChartValues.RUNNING + pieChartValues.IDLE + pieChartValues.ERROR;
        const liveEfficiency = totalPieTime > 0 ? ((pieChartValues.RUNNING / totalPieTime) * 100).toFixed(1) : '0.0';
        if (document.getElementById('efficiency')) {
             document.getElementById('efficiency').textContent = `${liveEfficiency}%`;
        }
    }
}

// Initialize the metrics pie chart
function initializeMetricsChart() {
    const ctx = document.getElementById('metricsChart').getContext('2d');
    metricsChart = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: ['Running', 'Idle', 'Error'],
            datasets: [{
                data: [0, 0, 0],
                backgroundColor: [
                    '#2ecc71', // Running - Green
                    '#f1c40f', // Idle - Yellow
                    '#e74c3c'  // Error - Red
                ],
                borderWidth: 1,
                borderColor: '#fff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            aspectRatio: 1,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        padding: 20,
                        font: {
                            size: 14
                        }
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const value = context.raw;
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const percentage = total > 0 ? Math.round((value / total) * 100) : 0;
                            return `${context.label}: ${percentage}% (${formatDuration(value)})`;
                        }
                    }
                }
            }
        }
    });
}

// Initialize the hourly runtime chart
function initializeHourlyChart() {
    const ctx = document.getElementById('hourlyChart').getContext('2d');
    hourlyChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: Array.from({length: 24}, (_, i) => `${i}:00`),
            datasets: [{
                label: 'Runtime (minutes)',
                data: Array(24).fill(0),
                backgroundColor: '#3498db'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Minutes'
                    }
                }
            },
            plugins: {
                legend: {
                    display: false
                }
            }
        }
    });
}

// Initialize the trend chart
function initializeTrendChart() {
    const ctx = document.getElementById('trendChart').getContext('2d');
    trendChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [
                {
                    label: 'Runtime (hours)',
                    data: [],
                    borderColor: '#3498db',
                    backgroundColor: 'rgba(52, 152, 219, 0.1)',
                    yAxisID: 'y',
                    fill: true
                },
                {
                    label: 'Efficiency (%)',
                    data: [],
                    borderColor: '#2ecc71',
                    backgroundColor: 'rgba(46, 204, 113, 0.1)',
                    yAxisID: 'y1',
                    fill: true
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            scales: {
                y: {
                    beginAtZero: true,
                    position: 'left',
                    title: {
                        display: true,
                        text: 'Runtime (hours)'
                    }
                },
                y1: {
                    beginAtZero: true,
                    position: 'right',
                    title: {
                        display: true,
                        text: 'Efficiency (%)'
                    },
                    grid: {
                        drawOnChartArea: false
                    }
                }
            },
            plugins: {
                legend: {
                    position: 'bottom'
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const label = context.dataset.label || '';
                            const value = context.parsed.y;
                            if (label.includes('Runtime')) {
                                return `${label}: ${formatDuration(value * 3600)}`; // Convert hours back to seconds
                            }
                            return `${label}: ${value.toFixed(1)}%`;
                        }
                    }
                }
            }
        }
    });
}

// Format duration in a human-readable way
function formatDuration(seconds) {
    if (seconds < 60) {
        return `${Math.round(seconds)}s`;
    } else if (seconds < 3600) {
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = Math.round(seconds % 60);
        return `${minutes}m ${remainingSeconds}s`;
    } else {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        return `${hours}h ${minutes}m`;
    }
}

// Initialize the chronograph
function initializeChronograph() {
    const chronographContainer = document.getElementById('chronograph-container');
    if (!chronographContainer) return;

    // Clear existing content
    chronographContainer.innerHTML = '';
    
    // Create timeline container
    const timeline = document.createElement('div');
    timeline.id = 'timeline';
    timeline.className = 'timeline';
    chronographContainer.appendChild(timeline);

    // Initial fetch of timeline data
    fetchTimelineData();
}

// Update the chronograph with new state data
function updateChronograph(stateData) {
    const timeline = document.getElementById('timeline');
    if (!timeline) return;

    // Clear existing content
    timeline.innerHTML = '';

    if (!stateData || stateData.length === 0) {
        // Show "No Data" message if no states
        const noDataSegment = document.createElement('div');
        noDataSegment.className = 'timeline-segment no-data';
        noDataSegment.style.width = '100%';
        noDataSegment.title = 'No data available for this period';
        timeline.appendChild(noDataSegment);
        return;
    }

    // Calculate total duration for scaling
    const firstStateTime = new Date(stateData[0].timestamp);
    const lastStateTime = new Date(stateData[stateData.length - 1].timestamp);
    const totalDuration = (lastStateTime - firstStateTime) / 1000;

    // Create timeline segments
    stateData.forEach((state, index) => {
        const segment = document.createElement('div');
        segment.className = `timeline-segment ${state.state.toLowerCase()}`;
        
        // Calculate width based on duration and total time range
        const duration = state.duration || 0;
        const width = Math.max(1, Math.min(100, (duration / totalDuration) * 100));
        segment.style.width = `${width}%`;
        
        // Add tooltip with state info
        const startTime = new Date(state.timestamp).toLocaleTimeString();
        const endTime = new Date(new Date(state.timestamp).getTime() + duration * 1000).toLocaleTimeString();
        const durationStr = formatDuration(duration);
        segment.title = `${state.state}\nStart: ${startTime}\nEnd: ${endTime}\nDuration: ${durationStr}\n${state.description || ''}`;
        
        // Add state label if segment is wide enough
        if (width > 15) {
            const label = document.createElement('span');
            label.className = 'state-label';
            label.textContent = state.state;
            segment.appendChild(label);
        }
        
        timeline.appendChild(segment);
    });

    // Add current time indicator if viewing today's data
    if (currentPeriod === 'today') {
        const now = new Date();
        const currentPosition = ((now - firstStateTime) / 1000) / totalDuration * 100;
        
        if (currentPosition >= 0 && currentPosition <= 100) {
            const indicator = document.createElement('div');
            indicator.className = 'current-time-indicator';
            indicator.style.left = `${currentPosition}%`;
            timeline.appendChild(indicator);
        }
    }

    // Add time markers
    const timeMarkers = document.createElement('div');
    timeMarkers.className = 'time-markers';
    
    // Calculate number of markers based on period
    let numMarkers;
    switch (currentPeriod) {
        case 'today':
            numMarkers = 5; // Every 2 hours
            break;
        case 'week':
            numMarkers = 5; // One per day
            break;
        case 'month':
            numMarkers = 4; // Weekly
            break;
        case 'quarter':
            numMarkers = 3; // Monthly
            break;
        default: // year
            numMarkers = 4; // Quarterly
    }

    for (let i = 0; i <= numMarkers; i++) {
        const marker = document.createElement('div');
        marker.className = 'time-marker';
        
        let time;
        if (currentPeriod === 'today') {
            // Show hours for today
            time = new Date(firstStateTime);
            time.setHours(7 + (i * 2));
            marker.textContent = time.toLocaleTimeString([], { hour: 'numeric', hour12: true });
        } else {
            // Show dates for other periods
            time = new Date(firstStateTime);
            if (currentPeriod === 'week') {
                time.setDate(time.getDate() + i);
                marker.textContent = time.toLocaleDateString([], { weekday: 'short' });
            } else if (currentPeriod === 'month') {
                time.setDate(1 + (i * 7));
                marker.textContent = time.toLocaleDateString([], { month: 'short', day: 'numeric' });
            } else if (currentPeriod === 'quarter') {
                time.setMonth(time.getMonth() + i);
                marker.textContent = time.toLocaleDateString([], { month: 'short' });
            } else {
                time.setMonth(i * 3);
                marker.textContent = time.toLocaleDateString([], { month: 'short' });
            }
        }
        
        marker.style.left = `${(i / numMarkers) * 100}%`;
        timeMarkers.appendChild(marker);
    }
    
    timeline.appendChild(timeMarkers);
}

// Fetch timeline data from the server
async function fetchTimelineData() {
    try {
        const response = await fetch(`/api/timeline?period=${currentPeriod}`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        updateChronograph(data);
    } catch (error) {
        console.error('Error fetching timeline data:', error);
    }
}

// Update state change log based on time period
async function updateStateChangeLog(period) {
    const stateFilter = document.getElementById('stateFilter').value;
    const limitFilter = document.getElementById('limitFilter').value;
    
    try {
        const response = await fetch(`/api/events/${period}?state=${stateFilter}&limit=${limitFilter}`);
        const events = await response.json();
        
        const tbody = document.getElementById('events-list');
        tbody.innerHTML = '';
        
        // Sort events in reverse chronological order (newest first)
        const sortedEvents = [...events].sort((a, b) => 
            new Date(b.timestamp) - new Date(a.timestamp)
        );
        
        sortedEvents.forEach(event => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${new Date(event.timestamp).toLocaleString()}</td>
                <td><span class="state-badge ${event.state.toLowerCase()}">${event.state}</span></td>
                <td class="duration-cell">${formatDuration(event.duration)}</td>
                <td>${event.description || '-'}</td>
            `;
            tbody.appendChild(row);
        });
    } catch (error) {
        console.error('Error updating state change log:', error);
    }
}

// Update metrics based on time period
async function updateMetrics(period) {
    try {
        const response = await fetch(`/api/metrics/${period}`);
        const data = await response.json();
        
        if (data.state_counts) {
            // Update base durations from server data
            stateDurations.RUNNING = data.state_counts.RUNNING || 0;
            stateDurations.IDLE = data.state_counts.IDLE || 0;
            stateDurations.ERROR = data.state_counts.ERROR || 0;
            
            // Update DOM elements for all state runtimes with these base values.
            // updateTimeDisplays will handle the live update for the CURRENT state's box.
            document.getElementById('runningTime').textContent = formatDuration(stateDurations.RUNNING);
            document.getElementById('idleTime').textContent = formatDuration(stateDurations.IDLE);
            document.getElementById('errorTime').textContent = formatDuration(stateDurations.ERROR);

            // Calculate efficiency based on these server-provided totals for summary fields
            const totalAccumulatedTime = stateDurations.RUNNING + stateDurations.IDLE + stateDurations.ERROR;
            const serverBasedEfficiency = totalAccumulatedTime > 0 ? ((stateDurations.RUNNING / totalAccumulatedTime) * 100).toFixed(1) : '0.0';

            if (data.summary) {
                document.getElementById('totalRuntime').textContent = formatDuration(data.summary.total_runtime || stateDurations.RUNNING);
                // Main 'efficiency' is live via updateTimeDisplays. This updates summary 'weeklyEfficiency'.
                document.getElementById('weeklyEfficiency').textContent = `${data.summary.weekly_efficiency || serverBasedEfficiency}%`;
                // If the 'efficiency' field is also part of a summary that should use serverBasedEfficiency:
                // document.getElementById('efficiency').textContent = `${data.summary.efficiency || serverBasedEfficiency}%`; 
                // However, for live counting, it's better handled by updateTimeDisplays.
                // For now, we assume 'efficiency' is the live one, and 'weeklyEfficiency' is summary.
                 if (document.getElementById('efficiency') && !data.summary.efficiency) { // If summary doesn't provide specific daily efficiency, update with serverBased
                    document.getElementById('efficiency').textContent = `${serverBasedEfficiency}%`;
                 }

                document.getElementById('bestDay').textContent = data.summary.best_day || 'N/A';
                document.getElementById('avgRuntime').textContent = formatDuration(data.summary.avg_daily_runtime || stateDurations.RUNNING);
            } else {
                 // Fallback if no summary data, ensure 'efficiency' and 'weeklyEfficiency' have a value
                if (document.getElementById('efficiency')) {
                    document.getElementById('efficiency').textContent = `${serverBasedEfficiency}%`;
                }
                if (document.getElementById('weeklyEfficiency')) {
                    document.getElementById('weeklyEfficiency').textContent = `${serverBasedEfficiency}%`;
                }
            }
            
            // Initial pie chart update based on server values when metrics are fetched.
            // updateTimeDisplays will then take over for live updates of the current state's slice.
            if (metricsChart) {
                metricsChart.data.datasets[0].data = [
                    stateDurations.RUNNING,
                    stateDurations.IDLE,
                    stateDurations.ERROR
                ];
                metricsChart.update('none');
            }

            if (data.hourly_metrics) { updateHourlyChart(data.hourly_metrics); }
            if (data.daily_metrics) { updateTrendChart(data.daily_metrics); }
        }
    } catch (error) {
        console.error('Error fetching metrics:', error);
    }
}

// Update hourly runtime chart
function updateHourlyChart(hourlyData) {
    const hours = Object.keys(hourlyData).sort();
    const runtimeData = hours.map(hour => {
        const metrics = hourlyData[hour];
        return metrics.running_duration / 60; // Convert to minutes
    });
    
    hourlyChart.data.datasets[0].data = runtimeData;
    hourlyChart.update('none'); // Use 'none' animation for smoother updates
    
    // Find and display peak hour
    const peakHour = hours.reduce((a, b) => 
        hourlyData[a].running_duration > hourlyData[b].running_duration ? a : b
    );
    document.getElementById('peakHour').textContent = 
        `${peakHour}:00 (${Math.round(hourlyData[peakHour].running_duration / 60)}m)`;
}

// Update trend chart
function updateTrendChart(dailyMetrics) {
    const days = Object.keys(dailyMetrics).sort();
    const runtimeData = days.map(day => {
        const metrics = dailyMetrics[day];
        return metrics.running_duration / 3600; // Convert to hours
    });
    const efficiencyData = days.map(day => {
        const metrics = dailyMetrics[day];
        return metrics.efficiency;
    });
    
    trendChart.data.labels = days.map(day => {
        const date = new Date(day);
        return date.toLocaleDateString('en-US', { weekday: 'short' });
    });
    trendChart.data.datasets = [
        {
            label: 'Runtime (hours)',
            data: runtimeData,
            borderColor: '#3498db',
            backgroundColor: 'rgba(52, 152, 219, 0.1)',
            yAxisID: 'y'
        },
        {
            label: 'Efficiency (%)',
            data: efficiencyData,
            borderColor: '#2ecc71',
            backgroundColor: 'rgba(46, 204, 113, 0.1)',
            yAxisID: 'y1'
        }
    ];
    trendChart.update('none'); // Use 'none' animation for smoother updates
}

// Handle time scale changes
function handleTimeScaleChange(period) {
    if (period === currentPeriod) return;
    
    // Update active tab
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.period === period);
    });
    
    currentPeriod = period;
    
    // Immediately update all components with new time scale
    updateMetrics(period);
    updateStateChangeLog(period);
    fetchTimelineData(); // Also update timeline when period changes
}

// Initialize WebSocket connection when page loads
document.addEventListener('DOMContentLoaded', () => {
    initializeCharts();
    updateMetrics(currentPeriod);
    
    // Initialize WebSocket connection
    initializeWebSocket();
    
    // Add click handlers for time scale tabs
    document.querySelector('.time-scale-tabs').addEventListener('click', (event) => {
        if (event.target.classList.contains('tab-btn')) {
            handleTimeScaleChange(event.target.dataset.period);
        }
    });
    
    // Add event listeners for log filters
    document.getElementById('stateFilter').addEventListener('change', () => updateStateChangeLog(currentPeriod));
    document.getElementById('limitFilter').addEventListener('change', () => updateStateChangeLog(currentPeriod));
    document.getElementById('refreshLog').addEventListener('click', () => updateStateChangeLog(currentPeriod));

    // Initialize theme
    initializeTheme();
});

// Initialize theme
function initializeTheme() {
    const themeToggle = document.getElementById('themeToggle');
    
    // Check for saved theme preference
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
        themeToggle.checked = true;
    }
    
    // Add theme toggle handler
    themeToggle.addEventListener('change', (e) => {
        if (e.target.checked) {
            document.documentElement.setAttribute('data-theme', 'dark');
            localStorage.setItem('theme', 'dark');
        } else {
            document.documentElement.removeAttribute('data-theme');
            localStorage.setItem('theme', 'light');
        }
    });
}

// WebSocket connection management
function initializeWebSocket() {
    if (ws !== null) {
        ws.close();
    }

    ws = new WebSocket(`ws://${window.location.host}/ws`);

    ws.onopen = () => {
        console.log('Connected to server');
        wsReconnectAttempts = 0; // Reset reconnection attempts on successful connection
        ws.send('get_state');
        // Restart incremental updates when connection is restored
        startIncrementalUpdates();
        startTimeUpdates();
    };

    ws.onmessage = function(event) {
        try {
            const data = JSON.parse(event.data);
            const previousState = currentState;
            const previousStateStartTime = stateStartTime;

            currentState = data.state;
            lastTagId = data.last_tag_id;
            
            document.getElementById('current-state').textContent = `Current Status: ${currentState}`;
            document.getElementById('tag-id').textContent = lastTagId !== null ? 
                `Tag ID: ${lastTagId}` : 'No tag detected';
            const stateIndicator = document.querySelector('.current-status');
            stateIndicator.className = `current-status ${currentState.toLowerCase()}`;
            
            if (previousState !== currentState) {
                // State transition occurred
                if (previousState && previousStateStartTime && previousState in stateDurations) {
                    const durationOfPreviousStateSessionSeconds = Math.floor((new Date() - previousStateStartTime) / 1000);
                    stateDurations[previousState] = (stateDurations[previousState] || 0) + durationOfPreviousStateSessionSeconds;
                    // Update the display for the state that just ended
                    document.getElementById(`${previousState.toLowerCase()}Time`).textContent = formatDuration(stateDurations[previousState]);
                }
                
                stateStartTime = new Date(); // Reset start time for the NEW current state
                saveStateInfo(currentState, stateStartTime);
                document.getElementById('state-duration').textContent = '0s';
                
                // Fetch latest metrics from server to update base stateDurations
                updateMetrics(currentPeriod);
                fetchTimelineData();
                updateStateChangeLog(currentPeriod);
            }
        } catch (error) {
            console.error('Error processing WebSocket message:', error);
        }
    };

    ws.onclose = (event) => {
        console.log('WebSocket connection closed:', event.code, event.reason);
        // Clear the update timers when connection is lost
        if (updateTimer) {
            clearInterval(updateTimer);
        }
        if (timeUpdateTimer) {
            clearInterval(timeUpdateTimer);
        }
        if (timelineUpdateTimer) {
            clearInterval(timelineUpdateTimer);
        }

        // Attempt to reconnect if not at max attempts
        if (wsReconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            wsReconnectAttempts++;
            console.log(`Attempting to reconnect (${wsReconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
            setTimeout(() => {
                initializeWebSocket();
            }, RECONNECT_DELAY);
        } else {
            console.error('Max reconnection attempts reached. Please refresh the page.');
            // Show reconnection error to user
            const stateIndicator = document.querySelector('.current-status');
            stateIndicator.className = 'current-status error';
            document.getElementById('current-state').textContent = 'Connection Lost';
            document.getElementById('tag-id').textContent = 'Please refresh the page to reconnect';
        }
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
    };
}

// Clean up timers when page is unloaded
window.addEventListener('beforeunload', () => {
    if (updateTimer) {
        clearInterval(updateTimer);
    }
    if (timeUpdateTimer) {
        clearInterval(timeUpdateTimer);
    }
    if (timelineUpdateTimer) {
        clearInterval(timelineUpdateTimer);
    }
    if (ws) {
        ws.close();
    }
});

async function clearAllData() {
    if (!confirm('Are you sure you want to clear all stored state data? This action cannot be undone.')) {
        return;
    }
    
    try {
        const response = await fetch('/api/clear_data', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        const result = await response.json();
        
        if (result.status === 'success') {
            alert('All state data cleared successfully');
            window.location.reload();
        } else {
            alert('Error clearing data: ' + result.message);
        }
    } catch (error) {
        console.error('Error clearing data:', error);
        alert('Failed to clear data. Please try again.');
    }
}

async function exportStateData() {
    try {
        const exportBtn = document.getElementById('exportDataBtn');
        const originalText = exportBtn.textContent;
        exportBtn.textContent = 'Exporting...';
        exportBtn.disabled = true;

        const response = await fetch('/api/export_states');
        
        if (!response.ok) {
            throw new Error(`Export failed: ${response.statusText}`);
        }
        
        const contentDisposition = response.headers.get('Content-Disposition');
        const filenameMatch = contentDisposition && contentDisposition.match(/filename=(.+)$/);
        const filename = filenameMatch ? filenameMatch[1] : 'state_changes.csv';
        
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
        
    } catch (error) {
        console.error('Error exporting state data:', error);
        alert('Failed to export state data. Please try again.');
    } finally {
        const exportBtn = document.getElementById('exportDataBtn');
        exportBtn.textContent = 'Export State Data';
        exportBtn.disabled = false;
    }
}

// Report Generation Functions
const modal = document.getElementById('reportModal');
const generateReportBtn = document.getElementById('generateReportBtn');
const closeModal = document.querySelector('.close-modal');

generateReportBtn.addEventListener('click', () => {
    modal.style.display = 'block';
});

closeModal.addEventListener('click', () => {
    modal.style.display = 'none';
});

window.addEventListener('click', (event) => {
    if (event.target === modal) {
        modal.style.display = 'none';
    }
});

document.querySelectorAll('.report-period-btn').forEach(button => {
    button.addEventListener('click', async () => {
        const period = button.dataset.period;
        button.classList.add('loading');
        try {
            await generateReport(period);
        } finally {
            button.classList.remove('loading');
            modal.style.display = 'none';
        }
    });
});

// Draw daily timelines for weekly report
async function drawDailyTimelines(doc, startY, period) {
    if (period !== 'week') return startY;

    doc.setFontSize(16);
    doc.text('Daily Runtime Timelines', 20, startY);
    startY += 10;

    const timelineStartX = 20;
    const timelineWidth = 170;
    const timelineHeight = 15;
    const workHours = 10; // 7 AM to 5 PM = 10 hours
    const daySpacing = 30; // Space between days

    // Get the start of the week (Monday)
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay() + (now.getDay() === 0 ? -6 : 1));
    startOfWeek.setHours(0, 0, 0, 0);

    // For each workday (Monday to Friday)
    for (let dayOffset = 0; dayOffset < 5; dayOffset++) {
        const currentDate = new Date(startOfWeek);
        currentDate.setDate(startOfWeek.getDate() + dayOffset);

        // Skip if this day is in the future
        if (currentDate > now) continue;

        // Add day label
        doc.setFontSize(12);
        doc.text(currentDate.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }), 
                timelineStartX, startY);
        startY += 5;

        // Draw timeline background
        doc.setFillColor(200, 200, 200);
        doc.rect(timelineStartX, startY, timelineWidth, timelineHeight, 'F');

        // Format date for API call (YYYY-MM-DD)
        const dateStr = currentDate.toISOString().split('T')[0];

        try {
            // Fetch state changes for this day
            const response = await fetch(`/api/events/date/${dateStr}?state=all&limit=1000`);
            const data = await response.json();

            if (data.error) {
                console.error(`Error fetching data for ${dateStr}:`, data.error);
                continue;
            }

            // Filter events for work hours (7 AM to 5 PM)
            const dayStart = new Date(currentDate);
            dayStart.setHours(7, 0, 0, 0);
            const dayEnd = new Date(currentDate);
            dayEnd.setHours(17, 0, 0, 0);

            const dayEvents = data.filter(event => {
                const eventTime = new Date(event.timestamp);
                return eventTime >= dayStart && eventTime <= dayEnd;
            });

            if (dayEvents.length > 0) {
                let lastEndTime = dayStart;
                
                // Sort events chronologically
                const sortedEvents = dayEvents.sort((a, b) => 
                    new Date(a.timestamp) - new Date(b.timestamp)
                );

                for (const event of sortedEvents) {
                    const eventTime = new Date(event.timestamp);
                    const adjustedTime = new Date(Math.max(eventTime, dayStart));

                    // Draw gap if needed
                    if (adjustedTime > lastEndTime) {
                        const gapWidth = ((adjustedTime - lastEndTime) / (workHours * 3600000)) * timelineWidth;
                        doc.setFillColor(149, 165, 166); // Gray for no data
                        doc.rect(
                            timelineStartX + ((lastEndTime - dayStart) / (workHours * 3600000)) * timelineWidth,
                            startY,
                            gapWidth,
                            timelineHeight,
                            'F'
                        );
                    }

                    // Draw state segment
                    const duration = event.duration * 1000;
                    const segmentEndTime = new Date(adjustedTime.getTime() + duration);
                    const adjustedEndTime = new Date(Math.min(segmentEndTime, dayEnd));
                    const segmentWidth = ((adjustedEndTime - adjustedTime) / (workHours * 3600000)) * timelineWidth;

                    // Set color based on state
                    switch (event.state) {
                        case 'RUNNING':
                            doc.setFillColor(46, 204, 113);
                            break;
                        case 'IDLE':
                            doc.setFillColor(241, 196, 15);
                            break;
                        case 'ERROR':
                            doc.setFillColor(231, 76, 60);
                            break;
                        default:
                            doc.setFillColor(149, 165, 166);
                    }

                    doc.rect(
                        timelineStartX + ((adjustedTime - dayStart) / (workHours * 3600000)) * timelineWidth,
                        startY,
                        segmentWidth,
                        timelineHeight,
                        'F'
                    );

                    lastEndTime = adjustedEndTime;
                }

                // Fill remaining time with no-data color if needed
                if (lastEndTime < dayEnd) {
                    const remainingWidth = ((dayEnd - lastEndTime) / (workHours * 3600000)) * timelineWidth;
                    doc.setFillColor(149, 165, 166);
                    doc.rect(
                        timelineStartX + ((lastEndTime - dayStart) / (workHours * 3600000)) * timelineWidth,
                        startY,
                        remainingWidth,
                        timelineHeight,
                        'F'
                    );
                }
            } else {
                // No data for this day
                doc.setFillColor(149, 165, 166);
                doc.rect(timelineStartX, startY, timelineWidth, timelineHeight, 'F');
            }

            // Add hour markers
            doc.setFontSize(8);
            doc.setTextColor(100);
            for (let hour = 7; hour <= 17; hour += 2) { // Show every 2 hours to avoid crowding
                const markerX = timelineStartX + ((hour - 7) / workHours) * timelineWidth;
                doc.line(markerX, startY + timelineHeight, markerX, startY + timelineHeight + 2);
                const displayHour = hour > 12 ? hour - 12 : hour;
                const ampm = hour >= 12 ? 'PM' : 'AM';
                doc.text(`${displayHour}${ampm}`, markerX - 6, startY + timelineHeight + 6);
            }

        } catch (error) {
            console.error(`Error processing timeline for ${dateStr}:`, error);
            // Draw error state
            doc.setFillColor(231, 76, 60);
            doc.rect(timelineStartX, startY, timelineWidth, timelineHeight, 'F');
        }

        startY += daySpacing;
    }

    // Add legend
    startY += 5;
    const legendSquareSize = 6;
    
    doc.setFontSize(10);
    doc.setTextColor(0);

    // Running
    doc.setFillColor(46, 204, 113);
    doc.rect(timelineStartX, startY, legendSquareSize, legendSquareSize, 'F');
    doc.text('Running', timelineStartX + 10, startY + 5);

    // Idle
    doc.setFillColor(241, 196, 15);
    doc.rect(timelineStartX + 50, startY, legendSquareSize, legendSquareSize, 'F');
    doc.text('Idle', timelineStartX + 60, startY + 5);

    // Error
    doc.setFillColor(231, 76, 60);
    doc.rect(timelineStartX + 90, startY, legendSquareSize, legendSquareSize, 'F');
    doc.text('Error', timelineStartX + 100, startY + 5);

    // No Data
    doc.setFillColor(149, 165, 166);
    doc.rect(timelineStartX + 130, startY, legendSquareSize, legendSquareSize, 'F');
    doc.text('No Data', timelineStartX + 140, startY + 5);

    return startY + 20;
}

// Modify the generateReport function to place the daily runtime timelines section before the state distribution section
async function generateReport(period) {
    try {
        // Fetch all necessary data
        const response = await fetch(`/api/metrics/${period}`);
        const data = await response.json();

        // If period is today, fetch timeline data
        let timelineData = null;
        if (period === 'today') {
            const timelineResponse = await fetch('/api/events/today?state=all&limit=1000');
            timelineData = await timelineResponse.json();
        }
        
        // Create PDF
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        
        // Title
        doc.setFontSize(20);
        doc.text('CNC Runtime Dashboard Report', 20, 20);
        
        // Period
        doc.setFontSize(14);
        doc.text(`Period: ${formatPeriod(period)}`, 20, 30);
        
        // Current Date
        const currentDate = new Date().toLocaleDateString();
        doc.text(`Generated on: ${currentDate}`, 20, 40);

        let currentY = 60;
        
        // If today's report, add timeline first
        if (period === 'today' && timelineData && timelineData.length > 0) {
            doc.setFontSize(16);
            doc.text('Today\'s Runtime Timeline', 20, currentY);
            currentY += 10;

            // Draw timeline
            const timelineStartX = 20;
            const timelineWidth = 170;
            const timelineHeight = 20;
            const workHours = 10; // 7 AM to 5 PM = 10 hours

            // Draw timeline background
            doc.setFillColor(200, 200, 200); // Light gray for background
            doc.rect(timelineStartX, currentY, timelineWidth, timelineHeight, 'F');

            // Sort timeline data chronologically
            const sortedData = [...timelineData].sort((a, b) => 
                new Date(a.timestamp) - new Date(b.timestamp)
            );

            // Filter to only include today's workday events (7 AM to 5 PM CST)
            const startTime = new Date();
            startTime.setHours(7, 0, 0, 0);
            const endTime = new Date();
            endTime.setHours(17, 0, 0, 0);

            // Draw state segments
            let lastEndTime = startTime;
            for (const entry of sortedData) {
                const currentTime = new Date(entry.timestamp);
                const adjustedCurrentTime = new Date(Math.max(currentTime, startTime));
                
                if (adjustedCurrentTime > lastEndTime) {
                    // Draw gap (no data)
                    const gapWidth = ((adjustedCurrentTime - lastEndTime) / (workHours * 3600000)) * timelineWidth;
                    doc.setFillColor(149, 165, 166); // Gray for no data
                    doc.rect(
                        timelineStartX + ((lastEndTime - startTime) / (workHours * 3600000)) * timelineWidth,
                        currentY,
                        gapWidth,
                        timelineHeight,
                        'F'
                    );
                }

                // Draw state segment
                const duration = entry.duration * 1000; // Convert seconds to milliseconds
                const segmentEndTime = new Date(adjustedCurrentTime.getTime() + duration);
                const adjustedEndTime = new Date(Math.min(segmentEndTime, endTime));
                
                const segmentWidth = ((adjustedEndTime - adjustedCurrentTime) / (workHours * 3600000)) * timelineWidth;
                
                // Set color based on state
                switch (entry.state) {
                    case 'RUNNING':
                        doc.setFillColor(46, 204, 113); // Green
                        break;
                    case 'IDLE':
                        doc.setFillColor(241, 196, 15); // Yellow
                        break;
                    case 'ERROR':
                        doc.setFillColor(231, 76, 60); // Red
                        break;
                    default:
                        doc.setFillColor(149, 165, 166); // Gray
                }

                doc.rect(
                    timelineStartX + ((adjustedCurrentTime - startTime) / (workHours * 3600000)) * timelineWidth,
                    currentY,
                    segmentWidth,
                    timelineHeight,
                    'F'
                );

                lastEndTime = adjustedEndTime;
            }

            // Draw time markers
            doc.setFontSize(8);
            doc.setTextColor(100);
            for (let hour = 7; hour <= 17; hour++) {
                const markerX = timelineStartX + ((hour - 7) / workHours) * timelineWidth;
                doc.line(markerX, currentY + timelineHeight, markerX, currentY + timelineHeight + 3);
                const displayHour = hour > 12 ? hour - 12 : hour;
                const ampm = hour >= 12 ? 'PM' : 'AM';
                doc.text(`${displayHour}${ampm}`, markerX - 6, currentY + timelineHeight + 8);
            }

            // Add timeline legend
            currentY += timelineHeight + 15;
            const legendY = currentY;
            const legendSquareSize = 6;

            // Running
            doc.setFillColor(46, 204, 113);
            doc.rect(timelineStartX, legendY, legendSquareSize, legendSquareSize, 'F');
            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Running', timelineStartX + 10, legendY + 5);

            // Idle
            doc.setFillColor(241, 196, 15);
            doc.rect(timelineStartX + 50, legendY, legendSquareSize, legendSquareSize, 'F');
            doc.text('Idle', timelineStartX + 60, legendY + 5);

            // Error
            doc.setFillColor(231, 76, 60);
            doc.rect(timelineStartX + 90, legendY, legendSquareSize, legendSquareSize, 'F');
            doc.text('Error', timelineStartX + 100, legendY + 5);

            // No Data
            doc.setFillColor(149, 165, 166);
            doc.rect(timelineStartX + 130, legendY, legendSquareSize, legendSquareSize, 'F');
            doc.text('No Data', timelineStartX + 140, legendY + 5);

            currentY += 20;
        }
        
        // Summary Section
        doc.setFontSize(16);
        doc.text('Summary', 20, currentY);
        currentY += 10;
        
        const totalRuntime = data.state_counts?.RUNNING || 0;
        const totalIdle = data.state_counts?.IDLE || 0;
        const totalError = data.state_counts?.ERROR || 0;
        const totalTime = totalRuntime + totalIdle + totalError;
        
        const efficiency = totalTime > 0 ? (totalRuntime / totalTime * 100).toFixed(1) : 0;
        
        doc.setFontSize(12);
        doc.text([
            `Total Runtime: ${formatDuration(totalRuntime)}`,
            `Total Idle Time: ${formatDuration(totalIdle)}`,
            `Total Error Time: ${formatDuration(totalError)}`,
            `Overall Efficiency: ${efficiency}%`
        ], 20, currentY, {
            lineHeightFactor: 1.5
        });
        currentY += 40;

        // State Distribution Section
        if (currentY > 220) {
            doc.addPage();
            currentY = 20;
        }

        doc.setFontSize(16);
        doc.text('State Distribution', 20, currentY);
        currentY += 20;

        // Draw bar chart for state distribution
        const barStartX = 20;
        const barStartY = currentY;
        const barWidth = 170;
        const barHeight = 25;
        const labelY = barStartY + barHeight + 15;

        if (totalTime > 0) {
            // Calculate percentages
            const runningPercentage = ((totalRuntime / totalTime) * 100).toFixed(1);
            const idlePercentage = ((totalIdle / totalTime) * 100).toFixed(1);
            const errorPercentage = ((totalError / totalTime) * 100).toFixed(1);

            // Draw the segments
            let currentX = barStartX;

            // Running segment (Green)
            if (totalRuntime > 0) {
                const runningWidth = (totalRuntime / totalTime) * barWidth;
                doc.setFillColor(46, 204, 113);
                doc.rect(currentX, barStartY, runningWidth, barHeight, 'F');
                
                if (runningWidth > 30) {
                    doc.setTextColor(255);
                    doc.setFontSize(10);
                    doc.text(`${runningPercentage}%`, currentX + runningWidth/2 - 8, barStartY + barHeight/2 + 3);
                }
                currentX += runningWidth;
            }

            // Idle segment (Yellow)
            if (totalIdle > 0) {
                const idleWidth = (totalIdle / totalTime) * barWidth;
                doc.setFillColor(241, 196, 15);
                doc.rect(currentX, barStartY, idleWidth, barHeight, 'F');
                
                if (idleWidth > 30) {
                    doc.setTextColor(0);
                    doc.setFontSize(10);
                    doc.text(`${idlePercentage}%`, currentX + idleWidth/2 - 8, barStartY + barHeight/2 + 3);
                }
                currentX += idleWidth;
            }

            // Error segment (Red)
            if (totalError > 0) {
                const errorWidth = (totalError / totalTime) * barWidth;
                doc.setFillColor(231, 76, 60);
                doc.rect(currentX, barStartY, errorWidth, barHeight, 'F');
                
                if (errorWidth > 30) {
                    doc.setTextColor(255);
                    doc.setFontSize(10);
                    doc.text(`${errorPercentage}%`, currentX + errorWidth/2 - 8, barStartY + barHeight/2 + 3);
                }
            }

            // Add legend with durations
            doc.setTextColor(0);
            doc.setFontSize(10);
            const legendY = labelY + 10;

            // Running legend
            doc.setFillColor(46, 204, 113);
            doc.rect(barStartX, legendY, 8, 8, 'F');
            doc.text(`Running: ${formatDuration(totalRuntime)} (${runningPercentage}%)`, barStartX + 12, legendY + 6);

            // Idle legend
            doc.setFillColor(241, 196, 15);
            doc.rect(barStartX, legendY + 15, 8, 8, 'F');
            doc.text(`Idle: ${formatDuration(totalIdle)} (${idlePercentage}%)`, barStartX + 12, legendY + 21);

            // Error legend
            doc.setFillColor(231, 76, 60);
            doc.rect(barStartX, legendY + 30, 8, 8, 'F');
            doc.text(`Error: ${formatDuration(totalError)} (${errorPercentage}%)`, barStartX + 12, legendY + 36);

            currentY = legendY + 50;
        } else {
            // If no data, show empty bar
            doc.setFillColor(200, 200, 200);
            doc.rect(barStartX, barStartY, barWidth, barHeight, 'F');
            doc.setTextColor(100);
            doc.setFontSize(10);
            doc.text('No Data', barStartX + barWidth/2 - 15, barStartY + barHeight/2 + 3);
            currentY = barStartY + barHeight + 30;
        }

        // Add daily timelines for weekly report after state distribution
        if (period === 'week') {
            // Add a page break before daily timelines if we're close to the bottom
            if (currentY > 220) {
                doc.addPage();
                currentY = 20;
            }
            currentY = await drawDailyTimelines(doc, currentY, period);
        }

        // Add a page break before Runtime Analysis if we're close to the bottom
        if (currentY > 220) {
            doc.addPage();
            currentY = 20;
        }

        // Add extra spacing before Runtime Analysis
        currentY += 20;

        // Runtime Analysis Section
        doc.setFontSize(16);
        doc.setTextColor(0);
        doc.text('Runtime Analysis', 20, currentY);
        currentY += 20;

        // Add runtime stats with durations
        doc.setFontSize(12);
        const runtimeStats = [
            ['Total Runtime', formatDuration(totalRuntime)],
            ['Total Idle Time', formatDuration(totalIdle)],
            ['Total Error Time', formatDuration(totalError)],
            ['Efficiency', `${efficiency}%`],
            ['Peak Performance', data.peak_hour ? `${data.peak_hour}:00` : 'N/A']
        ];

        doc.autoTable({
            body: runtimeStats,
            startY: currentY,
            theme: 'plain',
            styles: {
                fontSize: 11,
                cellPadding: 4
            },
            columnStyles: {
                0: { fontStyle: 'bold', cellWidth: 80 },
                1: { cellWidth: 90 }
            }
        });

        currentY = doc.autoTable.previous.finalY + 20;

        // Performance Trends Section
        doc.setFontSize(16);
        doc.text('Performance Trends', 20, currentY);
        currentY += 10;

        // Add trend stats with durations
        const trendStats = [
            ['Best Day', data.best_day || 'N/A'],
            ['Average Daily Runtime', formatDuration(totalRuntime / (data.days_in_period || 1))],
            ['Average Daily Idle', formatDuration(totalIdle / (data.days_in_period || 1))],
            ['Average Daily Error', formatDuration(totalError / (data.days_in_period || 1))],
            ['Weekly Efficiency', `${efficiency}%`]
        ];

        doc.autoTable({
            body: trendStats,
            startY: currentY,
            theme: 'plain',
            styles: {
                fontSize: 11,
                cellPadding: 4
            },
            columnStyles: {
                0: { fontStyle: 'bold', cellWidth: 80 },
                1: { cellWidth: 90 }
            }
        });

        currentY = doc.autoTable.previous.finalY + 20;

        // Hourly Analysis
        if (data.hourly_metrics) {
            doc.addPage();
            doc.setFontSize(16);
            doc.text('Hourly Analysis', 20, 20);
            
            const hourlyData = [];
            let totalRunningTime = 0;
            let totalIdleTime = 0;
            let totalErrorTime = 0;
            let totalWorkingHours = 0;

            // First pass: collect all hours between 7 AM and 5 PM
            const workHours = {};
            for (let hour = 7; hour <= 17; hour++) {
                workHours[hour] = {
                    running_duration: 0,
                    idle_duration: 0,
                    error_duration: 0
                };
            }

            // Process timeline data to get accurate state durations for each hour
            if (timelineData && timelineData.length > 0) {
                const sortedEvents = [...timelineData].sort((a, b) => 
                    new Date(a.timestamp) - new Date(b.timestamp)
                );

                for (let i = 0; i < sortedEvents.length; i++) {
                    const event = sortedEvents[i];
                    const eventTime = new Date(event.timestamp);
                    const eventHour = eventTime.getHours();
                    
                    // Skip if outside work hours
                    if (eventHour < 7 || eventHour > 17) continue;
                    
                    // Calculate duration until next event or end of hour
                    let duration = event.duration;
                    if (duration) {
                        // Add the duration to the appropriate state counter
                        switch (event.state) {
                            case 'RUNNING':
                                workHours[eventHour].running_duration += duration;
                                break;
                            case 'IDLE':
                                workHours[eventHour].idle_duration += duration;
                                break;
                            case 'ERROR':
                                workHours[eventHour].error_duration += duration;
                                break;
                        }
                    }
                }
            }

            // Process each work hour
            for (const [hour, metrics] of Object.entries(workHours)) {
                // Calculate total time for efficiency
                const hourTotal = metrics.running_duration + metrics.idle_duration + metrics.error_duration;
                const efficiency = hourTotal > 0 ? 
                    ((metrics.running_duration / hourTotal) * 100).toFixed(1) : 
                    '0.0';

                // Add to totals
                totalRunningTime += metrics.running_duration;
                totalIdleTime += metrics.idle_duration;
                totalErrorTime += metrics.error_duration;
                if (hourTotal > 0) totalWorkingHours++;

                hourlyData.push([
                    `${hour}:00`,
                    formatDuration(metrics.running_duration),
                    formatDuration(metrics.idle_duration),
                    formatDuration(metrics.error_duration),
                    `${efficiency}%`
                ]);
            }

            // Sort hourly data by hour
            hourlyData.sort((a, b) => {
                const hourA = parseInt(a[0]);
                const hourB = parseInt(b[0]);
                return hourA - hourB;
            });
            
            doc.autoTable({
                head: [['Hour', 'Runtime', 'Idle Time', 'Error Time', 'Efficiency']],
                body: hourlyData,
                startY: 30,
                margin: { top: 30 },
                styles: {
                    fontSize: 9,
                    textColor: [0, 0, 0]
                },
                columnStyles: {
                    0: { cellWidth: 30 }, // Hour
                    1: { cellWidth: 35 }, // Runtime
                    2: { cellWidth: 35 }, // Idle Time
                    3: { cellWidth: 35 }, // Error Time
                    4: { cellWidth: 35 }  // Efficiency
                },
                didParseCell: function(data) {
                    // Add color hints to efficiency column
                    if (data.column.index === 4 && data.section === 'body') {
                        const efficiency = parseFloat(data.cell.raw);
                        if (!isNaN(efficiency)) {
                            if (efficiency >= 80) {
                                data.cell.styles.textColor = [46, 204, 113]; // Green for high efficiency
                            } else if (efficiency >= 50) {
                                data.cell.styles.textColor = [241, 196, 15]; // Yellow for medium efficiency
                            } else {
                                data.cell.styles.textColor = [231, 76, 60]; // Red for low efficiency
                            }
                        }
                    }
                }
            });

            // Add summary statistics
            const summaryY = doc.autoTable.previous.finalY + 20;
            doc.setFontSize(12);
            doc.setTextColor(0);
            
            // Calculate average efficiency using total times
            const totalTime = totalRunningTime + totalIdleTime + totalErrorTime;
            const avgEfficiency = totalTime > 0 ? 
                ((totalRunningTime / totalTime) * 100).toFixed(1) : 
                '0.0';
            
            // Display summary
            doc.text([
                `Total Runtime: ${formatDuration(totalRunningTime)}`,
                `Total Idle Time: ${formatDuration(totalIdleTime)}`,
                `Total Error Time: ${formatDuration(totalErrorTime)}`,
                `Average Efficiency: ${avgEfficiency}%`,
                `Active Hours: ${totalWorkingHours} of ${Object.keys(workHours).length}`
            ], 20, summaryY, {
                lineHeightFactor: 1.5
            });
        }

        // Add State Change Log for today and week reports
        if (period === 'today' || period === 'week') {
            // Fetch state change log data without limit
            const logResponse = await fetch(`/api/events/${period}?state=all`);
            const logData = await logResponse.json();

            if (logData && logData.length > 0) {
                // Add new page for state change log
                doc.addPage();
                doc.setFontSize(16);
                doc.text('State Change Log', 20, 20);

                // Sort events in reverse chronological order (newest first)
                const sortedEvents = [...logData].sort((a, b) => 
                    new Date(b.timestamp) - new Date(a.timestamp)
                );

                // Prepare table data
                const logTableData = sortedEvents.map(event => {
                    const timestamp = new Date(event.timestamp);
                    const formattedTime = timestamp.toLocaleString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                        second: '2-digit',
                        hour12: true
                    });

                    return [
                        formattedTime,
                        event.state,
                        formatDuration(event.duration),
                        event.description || '-'
                    ];
                });

                // Add the table with styling
                doc.autoTable({
                    head: [['Time', 'State', 'Duration', 'Description']],
                    body: logTableData,
                    startY: 30,
                    margin: { top: 30 },
                    styles: {
                        fontSize: 9,
                        textColor: [0, 0, 0] // Default text color for non-state columns
                    },
                    columnStyles: {
                        0: { cellWidth: 50 }, // Time column
                        1: { 
                            cellWidth: 30,
                            fillColor: [255, 255, 255], // Default background for state column
                            textColor: [255, 255, 255] // White text for state column
                        },
                        2: { cellWidth: 30 }, // Duration column
                        3: { cellWidth: 'auto' } // Description column
                    },
                    didParseCell: function(data) {
                        // Only style the state column
                        if (data.column.index === 1 && data.section === 'body') {
                            const state = data.cell.raw;
                            
                            // Set background color based on state
                            switch (state) {
                                case 'RUNNING':
                                    data.cell.styles.fillColor = [46, 204, 113]; // Solid green
                                    break;
                                case 'IDLE':
                                    data.cell.styles.fillColor = [241, 196, 15]; // Solid yellow
                                    break;
                                case 'ERROR':
                                    data.cell.styles.fillColor = [231, 76, 60]; // Solid red
                                    break;
                                default:
                                    data.cell.styles.fillColor = [189, 195, 199]; // Solid gray for unknown states
                            }
                        }
                    }
                });

                // Add note about the number of events shown
                const totalEvents = logData.length;
                doc.setFontSize(10);
                doc.setTextColor(100);
                doc.text(
                    `Total state changes: ${totalEvents}`,
                    20,
                    doc.autoTable.previous.finalY + 10
                );
            }
        }
        
        // Save the PDF
        const fileName = `runtime-report-${period}-${currentDate.replace(/\//g, '-')}.pdf`;
        doc.save(fileName);
        
    } catch (error) {
        console.error('Error generating report:', error);
        alert('Failed to generate report. Please try again.');
    }
}

function formatPeriod(period) {
    const periods = {
        'today': 'Today',
        'week': 'This Week',
        'month': 'This Month',
        'quarter': 'This Quarter',
        'year': 'This Year'
    };
    return periods[period] || period;
} 