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

// Initialize chronograph timeline
function initializeChronograph() {
    const timeline = document.getElementById('chronographTimeline');
    const markers = document.getElementById('timeMarkers');
    
    // Clear existing content
    timeline.innerHTML = '';
    markers.innerHTML = '';
    
    // Add time markers (7 AM to 5 PM)
    for (let hour = 7; hour <= 17; hour++) {
        const marker = document.createElement('div');
        marker.className = 'time-marker';
        const displayHour = hour > 12 ? hour - 12 : hour;
        const ampm = hour >= 12 ? 'PM' : 'AM';
        marker.textContent = `${displayHour}:00 ${ampm}`;
        markers.appendChild(marker);
    }
}

// Fetch timeline data independently
async function fetchTimelineData() {
    try {
        // Fetch all states for today's workday with a large limit to get all events
        const response = await fetch('/api/events/today?state=all&limit=1000');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const events = await response.json();
        
        // If we have a current state that's not in the events (newest state),
        // add it to the events array with current duration
        if (currentState && stateStartTime) {
            const now = new Date();
            const duration = Math.floor((now - stateStartTime) / 1000); // Convert to seconds
            
            // Only add if it's actually a new state
            const lastEvent = events[events.length - 1];
            if (!lastEvent || new Date(lastEvent.timestamp) < stateStartTime) {
                events.push({
                    timestamp: stateStartTime.toISOString(),
                    state: currentState,
                    duration: duration,
                    description: 'Current state'
                });
            }
        }
        
        updateChronograph(events);
    } catch (error) {
        console.error('Error fetching timeline data:', error);
        // Show error state in timeline
        const timeline = document.getElementById('chronographTimeline');
        timeline.innerHTML = '';
        const errorSegment = document.createElement('div');
        errorSegment.className = 'timeline-segment error';
        errorSegment.style.width = '100%';
        errorSegment.title = 'Error loading timeline data';
        timeline.appendChild(errorSegment);
    }
}

// Update chronograph timeline with state data
function updateChronograph(stateData) {
    const timeline = document.getElementById('chronographTimeline');
    if (!timeline) return;

    // Clear existing timeline
    timeline.innerHTML = '';

    // Get current time in CST
    const now = new Date();
    const cstOffset = -6; // CST is UTC-6
    const cstTime = new Date(now.getTime() + (cstOffset * 60 * 60 * 1000));

    // Set workday window (7 AM to 5 PM)
    const workdayStart = new Date(cstTime);
    workdayStart.setHours(7, 0, 0, 0);
    const workdayEnd = new Date(cstTime);
    workdayEnd.setHours(17, 0, 0, 0);

    // Calculate total duration
    const totalDuration = workdayEnd - workdayStart;

    // If current time is before 7 AM, add grey bar
    if (cstTime < workdayStart) {
        const beforeWorkSegment = document.createElement('div');
        beforeWorkSegment.className = 'timeline-segment no-data';
        beforeWorkSegment.style.width = '100%';
        beforeWorkSegment.title = 'Outside work hours (7 AM - 5 PM)';
        timeline.appendChild(beforeWorkSegment);
        return;
    }

    // If no data or empty array, show grey bar
    if (!stateData || stateData.length === 0) {
        const noDataSegment = document.createElement('div');
        noDataSegment.className = 'timeline-segment no-data';
        noDataSegment.style.width = '100%';
        noDataSegment.title = 'No data available';
        timeline.appendChild(noDataSegment);
        return;
    }

    // Sort data chronologically
    const sortedData = [...stateData].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    // Filter data to only include today's workday events
    const filteredData = sortedData.filter(event => {
        const eventTime = new Date(event.timestamp);
        return eventTime >= workdayStart && eventTime <= workdayEnd;
    });

    // If no filtered data, show grey bar
    if (filteredData.length === 0) {
        const noDataSegment = document.createElement('div');
        noDataSegment.className = 'timeline-segment no-data';
        noDataSegment.style.width = '100%';
        noDataSegment.title = 'No data for today\'s work hours';
        timeline.appendChild(noDataSegment);
        return;
    }

    // Create timeline segments
    let lastEndTime = workdayStart;
    filteredData.forEach((event, index) => {
        const eventTime = new Date(event.timestamp);
        
        // Add gap segment if there's a gap between events
        if (eventTime > lastEndTime) {
            const gapDuration = eventTime - lastEndTime;
            const gapWidth = (gapDuration / totalDuration) * 100;
            const gapSegment = document.createElement('div');
            gapSegment.className = 'timeline-segment no-data';
            gapSegment.style.width = `${gapWidth}%`;
            gapSegment.title = `No data from ${lastEndTime.toLocaleTimeString()} to ${eventTime.toLocaleTimeString()}`;
            timeline.appendChild(gapSegment);
        }

        // Add event segment
        const nextEvent = filteredData[index + 1];
        const endTime = nextEvent ? new Date(nextEvent.timestamp) : Math.min(workdayEnd, cstTime);
        const duration = endTime - eventTime;
        const width = (duration / totalDuration) * 100;

        const segment = document.createElement('div');
        segment.className = `timeline-segment ${event.state.toLowerCase()}`;
        segment.style.width = `${width}%`;
        segment.title = `${event.state} from ${eventTime.toLocaleTimeString()} to ${endTime.toLocaleTimeString()} (${formatDuration(duration)})`;
        timeline.appendChild(segment);

        lastEndTime = endTime;
    });

    // Add final gap if needed
    if (lastEndTime < Math.min(workdayEnd, cstTime)) {
        const finalGapDuration = Math.min(workdayEnd, cstTime) - lastEndTime;
        const finalGapWidth = (finalGapDuration / totalDuration) * 100;
        const finalGapSegment = document.createElement('div');
        finalGapSegment.className = 'time-segment no-data';
        finalGapSegment.style.width = `${finalGapWidth}%`;
        finalGapSegment.title = `No data from ${lastEndTime.toLocaleTimeString()} to ${Math.min(workdayEnd, cstTime).toLocaleTimeString()}`;
        timeline.appendChild(finalGapSegment);
    }
}

// Update state change log based on time period
async function updateStateChangeLog(period) {
    const stateFilter = document.getElementById('stateFilter').value;
    const limitFilter = document.getElementById('limitFilter').value;
    
    try {
        const response = await fetch(`/api/events/${period}?state=${stateFilter}&limit=${limitFilter}`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const events = await response.json();
        
        const tbody = document.getElementById('events-list');
        if (!tbody) {
            console.error('Events list table body not found');
            return;
        }
        
        tbody.innerHTML = '';
        
        if (!events || events.length === 0) {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td colspan="4" style="text-align: center; padding: 20px;">
                    No state changes recorded for this period
                </td>
            `;
            tbody.appendChild(row);
            return;
        }
        
        // Sort events in reverse chronological order (newest first)
        const sortedEvents = [...events].sort((a, b) => 
            new Date(b.timestamp) - new Date(a.timestamp)
        );
        
        sortedEvents.forEach(event => {
            const row = document.createElement('tr');
            const timestamp = new Date(event.timestamp);
            const formattedTime = timestamp.toLocaleString('en-US', {
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
                second: '2-digit',
                hour12: true
            });
            
            row.innerHTML = `
                <td>${formattedTime}</td>
                <td><span class="state-badge ${event.state.toLowerCase()}">${event.state}</span></td>
                <td class="duration-cell">${formatDuration(event.duration)}</td>
                <td>${event.description || '-'}</td>
            `;
            tbody.appendChild(row);
        });
    } catch (error) {
        console.error('Error updating state change log:', error);
        const tbody = document.getElementById('events-list');
        if (tbody) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="4" style="text-align: center; padding: 20px; color: var(--error-color);">
                        Error loading state changes. Please try again.
                    </td>
                </tr>
            `;
        }
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
document.addEventListener('DOMContentLoaded', async () => {
    // Initialize charts
    initializeCharts();
    
    // Initialize WebSocket connection
    initializeWebSocket();
    
    // Initialize settings
    await initializeSettings();
    
    // Start periodic updates
    startIncrementalUpdates();
    startTimelineUpdates();
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
const reportModal = document.getElementById('reportModal');
const generateReportBtn = document.getElementById('generateReportBtn');
const reportCloseBtn = reportModal.querySelector('.close-modal');

generateReportBtn.addEventListener('click', () => {
    reportModal.classList.add('show');
});

reportCloseBtn.addEventListener('click', () => {
    reportModal.classList.remove('show');
});

window.addEventListener('click', (event) => {
    if (event.target === reportModal) {
        reportModal.classList.remove('show');
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
            reportModal.classList.remove('show');
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
        ]);

        // Daily Timelines Section
        currentY = await drawDailyTimelines(doc, currentY, period);

        // State Distribution Section
        doc.setFontSize(16);
        doc.text('State Distribution', 20, currentY);
        currentY += 10;

        // Pie Chart
        doc.setFontSize(12);
        doc.text('Pie Chart', 20, currentY);
        currentY += 10;

        if (metricsChart) {
            const pieChartData = metricsChart.data.datasets[0].data;
            const pieChartLabels = ['Running', 'Idle', 'Error'];
            const pieChartColors = [
                '#2ecc71', // Running - Green
                '#f1c40f', // Idle - Yellow
                '#e74c3c'  // Error - Red
            ];

            doc.setFontSize(10);
            doc.setTextColor(0);
            pieChartLabels.forEach((label, index) => {
                doc.text(`${label}: ${formatDuration(pieChartData[index])}`, 20, currentY);
                currentY += 5;
            });

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            pieChartLabels.forEach((label, index) => {
                doc.text(`${label}: ${pieChartData[index]}%`, 20, currentY);
                currentY += 5;
            });

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text(`Total: ${formatDuration(totalTime)}`, 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text(`Efficiency: ${efficiency}%`, 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            currentY += 5;

            doc.setFontSize(12);
            doc.setTextColor(0);
            doc.text('Pie Chart', 20, currentY);
            doc.setText