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
    timeline.style.position = 'relative';
    timeline.style.display = 'flex';
    timeline.style.flexDirection = 'column';
    timeline.style.alignItems = 'stretch';

    // Timeline range: 7AM to 5PM (600 minutes)
    const now = new Date();
    const today = new Date(now);
    today.setHours(0, 0, 0, 0);
    const workdayStart = new Date(today); workdayStart.setHours(7, 0, 0, 0);
    const workdayEnd = new Date(today); workdayEnd.setHours(17, 0, 0, 0);
    const timelineEnd = now < workdayEnd ? now : workdayEnd;
    const totalMinutes = 600;
    const totalMs = 600 * 60 * 1000;

    // Preprocess: sort, merge adjacent, and fill gaps
    let sortedStates = (stateData || []).filter(e => {
        const t = new Date(e.timestamp);
        return t >= workdayStart && t < workdayEnd;
    }).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    // Merge adjacent same-state blocks
    let merged = [];
    let last = null;
    for (let i = 0; i < sortedStates.length; i++) {
        const state = sortedStates[i];
        const stateTime = new Date(state.timestamp);
        let duration = state.duration || 0;
        let nextTime;
        if (i < sortedStates.length - 1) {
            nextTime = new Date(sortedStates[i + 1].timestamp);
            duration = Math.min(duration, (nextTime - stateTime) / 1000);
        } else {
            // Last segment: end at now or workdayEnd, whichever is earlier
            const segmentEnd = (now < workdayEnd ? now : workdayEnd);
            duration = Math.max(0, (segmentEnd - stateTime) / 1000);
        }
        if (last && last.state === state.state && last.endTime.getTime() === stateTime.getTime()) {
            last.duration += duration;
            last.endTime = new Date(stateTime.getTime() + duration * 1000);
        } else {
            last = {
                state: state.state,
                startTime: stateTime,
                endTime: new Date(stateTime.getTime() + duration * 1000),
                duration: duration,
                description: state.description,
                tag_id: state.tag_id
            };
            merged.push(last);
        }
    }

    // Build timeline blocks
    let timelineBlocks = [];
    let cursor = new Date(workdayStart);
    // Pre-7AM (if any)
    if (now > workdayStart) {
        if (cursor < workdayStart) {
            timelineBlocks.push({
                state: 'NO_DATA',
                startTime: new Date(cursor),
                endTime: new Date(workdayStart),
                duration: (workdayStart - cursor) / 1000,
                description: 'Pre-shift',
                tag_id: null,
                preShift: true
            });
            cursor = new Date(workdayStart);
        }
        // Fill from 7AM to now
        for (let i = 0; i < merged.length; i++) {
            const block = merged[i];
            if (block.startTime > cursor) {
                timelineBlocks.push({
                    state: 'NO_DATA',
                    startTime: new Date(cursor),
                    endTime: new Date(block.startTime),
                    duration: (block.startTime - cursor) / 1000,
                    description: 'No data available',
                    tag_id: null
                });
            }
            // Clamp block to not go past now
            let blockEnd = block.endTime > timelineEnd ? timelineEnd : block.endTime;
            let blockDuration = (blockEnd - block.startTime) / 1000;
            if (blockEnd > block.startTime) {
                timelineBlocks.push({
                    ...block,
                    endTime: blockEnd,
                    duration: blockDuration
                });
            }
            cursor = blockEnd;
            if (cursor >= timelineEnd) break;
        }
        // Fill from last state to now if needed
        if (cursor < timelineEnd) {
            timelineBlocks.push({
                state: 'NO_DATA',
                startTime: new Date(cursor),
                endTime: new Date(timelineEnd),
                duration: (timelineEnd - cursor) / 1000,
                description: 'No data available',
                tag_id: null
            });
            cursor = new Date(timelineEnd);
        }
        // Post-now (if before 5PM)
        if (timelineEnd < workdayEnd) {
            timelineBlocks.push({
                state: 'NO_DATA',
                startTime: new Date(timelineEnd),
                endTime: new Date(workdayEnd),
                duration: (workdayEnd - timelineEnd) / 1000,
                description: 'Post-shift',
                tag_id: null,
                postShift: true
            });
        }
    } else {
        // If now is before 7AM, whole bar is pre-shift
        timelineBlocks.push({
            state: 'NO_DATA',
            startTime: new Date(workdayStart),
            endTime: new Date(workdayEnd),
            duration: (workdayEnd - workdayStart) / 1000,
            description: 'Pre-shift',
            tag_id: null,
            preShift: true
        });
    }

    // Timeline bar container
    const bar = document.createElement('div');
    bar.className = 'timeline-bar';
    bar.style.position = 'relative';
    bar.style.width = '100%';
    bar.style.height = '32px';
    bar.style.background = '#fff';

    // Calculate and position each block
    timelineBlocks.forEach((block) => {
        const seg = document.createElement('div');
        const startOffset = (block.startTime - workdayStart) / 60000; // minutes since 7am
        const blockDuration = (block.endTime - block.startTime) / 60000; // duration in minutes
        
        seg.className = `timeline-segment ${block.state.toLowerCase().replaceAll('_', '-')}`;
        if (block.preShift || block.postShift) {
            seg.className += ' timeline-segment-light';
        }
        
        // Position absolutely based on actual timestamps
        seg.style.position = 'absolute';
        seg.style.left = `${(startOffset / totalMinutes) * 100}%`;
        seg.style.width = `${(blockDuration / totalMinutes) * 100}%`;
        seg.style.height = '100%';
        seg.style.minWidth = '2px';
        seg.style.cursor = 'pointer';
        
        // Tooltip
        const startTime = block.startTime.toLocaleTimeString();
        const endTime = block.endTime.toLocaleTimeString();
        const durationStr = formatDuration((block.endTime - block.startTime) / 1000);
        seg.title = `${block.state}\nStart: ${startTime}\nEnd: ${endTime}\nDuration: ${durationStr}\n${block.description || ''}`;
        
        bar.appendChild(seg);
    });

    // Add hour dividers
    for (let hour = 7; hour <= 17; hour++) {
        if (hour === 7) continue; // skip left edge
        const divider = document.createElement('div');
        divider.className = 'timeline-hour-divider';
        divider.style.position = 'absolute';
        divider.style.left = `${((hour - 7) / 10) * 100}%`;
        divider.style.top = '0';
        divider.style.bottom = '0';
        divider.style.width = '1px';
        divider.style.background = '#e5e7eb';
        divider.style.zIndex = '2';
        bar.appendChild(divider);
    }

    // Add current time indicator
    if (now >= workdayStart && now <= workdayEnd) {
        const nowPos = ((now - workdayStart) / totalMs) * 100;
        const indicator = document.createElement('div');
        indicator.className = 'current-time-indicator';
        indicator.style.position = 'absolute';
        indicator.style.top = '0';
        indicator.style.bottom = '0';
        indicator.style.width = '2px';
        indicator.style.left = `${nowPos}%`;
        indicator.style.background = '#222';
        indicator.style.zIndex = '3';
        bar.appendChild(indicator);
    }

    timeline.appendChild(bar);

    // Add time markers below
    const timeMarkers = document.createElement('div');
    timeMarkers.className = 'time-markers';
    for (let hour = 7; hour <= 17; hour++) {
        const marker = document.createElement('div');
        marker.className = 'time-marker';
        let displayHour = hour > 12 ? hour - 12 : hour;
        let ampm = hour >= 12 ? 'PM' : 'AM';
        marker.textContent = `${displayHour} ${ampm}`;
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
        const sortedEvents = [...events].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        const now = new Date();
        sortedEvents.forEach((event, idx) => {
            let duration = event.duration;
            // If this is the most recent event and duration is 0, show live time in state
            if (idx === 0 && (!duration || duration === 0)) {
                const start = new Date(event.timestamp);
                duration = Math.max(0, (now - start) / 1000);
            }
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${new Date(event.timestamp).toLocaleString()}</td>
                <td><span class="state-badge ${event.state.toLowerCase()}">${event.state}</span></td>
                <td class="duration-cell">${formatDuration(duration)}</td>
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
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        if (!data || !data.state_counts) {
            console.warn('No metrics data returned from server:', data);
            showNoDataMessage('metricsChart');
            showNoDataMessage('hourlyChart');
            showNoDataMessage('trendChart');
            return;
        }
        
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
        showNoDataMessage('metricsChart');
        showNoDataMessage('hourlyChart');
        showNoDataMessage('trendChart');
    }
}

function showNoDataMessage(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.font = '16px Arial';
        ctx.fillStyle = '#888';
        ctx.textAlign = 'center';
        ctx.fillText('No Data', canvas.width / 2, canvas.height / 2);
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
            updateMetrics(event.target.dataset.period); // Ensure metrics update on tab change
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
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();

        // Create PDF document
        const doc = new jsPDF();
        let yPos = 20;

        // Add title
        doc.setFontSize(20);
        doc.text('Runtime Report', 20, yPos);
        yPos += 15;

        // Add period
        doc.setFontSize(14);
        const periodText = period.charAt(0).toUpperCase() + period.slice(1);
        doc.text(`Period: ${periodText}`, 20, yPos);
        yPos += 15;

        // Add summary metrics
        doc.setFontSize(12);
        if (data.summary) {
            doc.text(`Total Runtime: ${formatDuration(data.summary.total_runtime || 0)}`, 20, yPos);
            yPos += 10;
            doc.text(`Efficiency: ${data.summary.efficiency || 0}%`, 20, yPos);
            yPos += 10;
            doc.text(`Best Day: ${data.summary.best_day || 'N/A'}`, 20, yPos);
            yPos += 10;
            doc.text(`Average Daily Runtime: ${formatDuration(data.summary.avg_daily_runtime || 0)}`, 20, yPos);
            yPos += 20;
        }

        // Add state distribution
        if (data.state_counts) {
            doc.setFontSize(14);
            doc.text('State Distribution', 20, yPos);
            yPos += 15;

            doc.setFontSize(12);
            const totalTime = Object.values(data.state_counts).reduce((a, b) => a + b, 0);
            for (const [state, duration] of Object.entries(data.state_counts)) {
                const percentage = totalTime > 0 ? ((duration / totalTime) * 100).toFixed(1) : 0;
                doc.text(`${state}: ${formatDuration(duration)} (${percentage}%)`, 20, yPos);
                yPos += 10;
            }
            yPos += 10;
        }

        // Add daily timelines for weekly report
        if (period === 'week') {
            yPos = await drawDailyTimelines(doc, yPos, period);
        }

        // Add hourly distribution
        if (data.hourly_metrics) {
            doc.setFontSize(14);
            doc.text('Hourly Distribution', 20, yPos);
            yPos += 15;

            doc.setFontSize(12);
            const hours = Object.keys(data.hourly_metrics).sort();
            for (const hour of hours) {
                const metrics = data.hourly_metrics[hour];
                doc.text(`${hour}:00 - ${formatDuration(metrics.running_duration)} running`, 20, yPos);
                yPos += 10;
            }
        }

        // Save the PDF
        const filename = `runtime_report_${period}_${new Date().toISOString().split('T')[0]}.pdf`;
        doc.save(filename);

    } catch (error) {
        console.error('Error generating report:', error);
        alert('Failed to generate report. Please try again.');
    }
}