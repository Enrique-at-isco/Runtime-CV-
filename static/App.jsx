import React, { useState, useEffect } from 'react';
import ChronographBar from './components/ChronographBar';
import Settings from './components/Settings';

function App() {
    const [currentState, setCurrentState] = useState('IDLE');
    const [description, setDescription] = useState('');
    const [lastTagId, setLastTagId] = useState(null);
    const [showSettings, setShowSettings] = useState(false);

    useEffect(() => {
        // Load equipment name and set initial title
        fetch('/api/equipment/name')
            .then(response => response.json())
            .then(data => {
                document.title = `Runtime Dashboard: ${data.name}`;
            })
            .catch(console.error);

        const ws = new WebSocket(`ws://${window.location.host}/ws`);
        
        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            setCurrentState(data.state);
            setDescription(data.description);
            setLastTagId(data.last_tag_id);
        };

        ws.onclose = () => {
            console.log('WebSocket connection closed');
        };

        return () => {
            ws.close();
        };
    }, []);

    return (
        <div className="min-h-screen bg-gray-100">
            <nav className="bg-white shadow-sm">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex justify-between h-16">
                        <div className="flex">
                            <div className="flex-shrink-0 flex items-center">
                                <h1 className="text-xl font-bold">CNC Dashboard</h1>
                            </div>
                        </div>
                        <div className="flex items-center">
                            <button
                                onClick={() => setShowSettings(!showSettings)}
                                className="ml-4 px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700"
                            >
                                {showSettings ? 'Hide Settings' : 'Settings'}
                            </button>
                        </div>
                    </div>
                </div>
            </nav>

            <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
                {showSettings ? (
                    <Settings />
                ) : (
                    <div className="px-4 py-6 sm:px-0">
                        <div className="bg-white shadow rounded-lg p-6">
                            <h2 className="text-lg font-medium mb-4">Current State</h2>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <p className="text-sm text-gray-500">Status</p>
                                    <p className="text-xl font-semibold">{currentState}</p>
                                </div>
                                <div>
                                    <p className="text-sm text-gray-500">Description</p>
                                    <p className="text-xl font-semibold">{description}</p>
                                </div>
                                {lastTagId && (
                                    <div>
                                        <p className="text-sm text-gray-500">Last Tag ID</p>
                                        <p className="text-xl font-semibold">{lastTagId}</p>
                                    </div>
                                )}
                            </div>
                        </div>
                        
                        <div className="mt-8">
                            <ChronographBar />
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}

export default App; 