import random
import asyncio
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from models import MachineState, SessionLocal

class CNCSimulator:
    def __init__(self):
        self.states = ['RUNNING', 'IDLE', 'ERROR']
        self.current_state = 'IDLE'
        self.state_probabilities = {
            'IDLE': {'RUNNING': 0.8, 'ERROR': 0.2},
            'RUNNING': {'IDLE': 0.7, 'ERROR': 0.3},
            'ERROR': {'IDLE': 1.0}
        }
        self.state_durations = {
            'RUNNING': (300, 3600),    # 5 minutes to 1 hour
            'IDLE': (60, 900),         # 1 to 15 minutes
            'ERROR': (30, 300)         # 30 seconds to 5 minutes
        }
        self.descriptions = {
            'RUNNING': ['Normal operation', 'Production run', 'Processing job'],
            'IDLE': ['Waiting for operator', 'Job complete', 'Scheduled pause'],
            'ERROR': ['Emergency stop', 'Tool change needed', 'Temperature warning']
        }

    def _get_next_state(self):
        probabilities = self.state_probabilities[self.current_state]
        rand = random.random()
        cumulative_prob = 0
        for state, prob in probabilities.items():
            cumulative_prob += prob
            if rand <= cumulative_prob:
                return state
        return list(probabilities.keys())[0]

    def _get_duration(self, state):
        min_duration, max_duration = self.state_durations[state]
        return random.uniform(min_duration, max_duration)

    def _get_description(self, state):
        return random.choice(self.descriptions[state])

    async def generate_state(self):
        next_state = self._get_next_state()
        duration = self._get_duration(next_state)
        description = self._get_description(next_state)
        
        state = MachineState(
            state=next_state,
            duration=duration,
            description=description
        )
        
        self.current_state = next_state
        return state, duration

    async def run(self):
        while True:
            state, duration = await self.generate_state()
            db = SessionLocal()
            try:
                db.add(state)
                db.commit()
                # Sleep using the duration we got from generate_state
                await asyncio.sleep(min(duration, 10))  # Max 10 second sleep
            except Exception as e:
                db.rollback()
                print(f"Error in simulator: {e}")
            finally:
                db.close()

simulator = CNCSimulator() 